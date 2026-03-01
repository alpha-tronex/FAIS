import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User, type UserDoc } from '../models.js';
import { toUserDTO } from '../mappers/user.mapper.js';
import { computeSsnLast4, decryptSsn, encryptSsn } from '../security/ssn-crypto.js';
import { sendPasswordResetEmail } from '../services/invite-email.service.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';

const PASSWORD_RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

const loginSchema = z.object({
  uname: z.string().min(1).max(25),
  password: z.string().min(1)
});

const changePasswordSchema = z.object({
  newPassword: z.string().min(8)
});

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8)
});

const meUpdateSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  gender: z.string().max(50).optional(),
  dateOfBirth: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
  addressLine1: z.string().min(1).max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(50).optional(),
  zipCode: z.string().min(1).max(20).optional(),
  phone: z.string().min(1).max(50).optional()
});

const meSsnUpdateSchema = z
  .object({
    ssn: z.string().min(1).max(20),
    confirmSsn: z.string().min(1).max(20)
  })
  .refine((v) => v.ssn.trim() === v.confirmSsn.trim(), {
    message: 'SSNs do not match',
    path: ['confirmSsn']
  });

/** Default JWT lifetime when JWT_EXPIRES_IN is not set (e.g. '15m', '1h'). */
const DEFAULT_JWT_EXPIRES_IN = '15m';

export function createAuthRouter(
  deps: { jwtSecret: string; jwtExpiresIn?: string } & Pick<AuthMiddlewares, 'requireAuth'>
): express.Router {
  const router = express.Router();
  const expiresIn = (deps.jwtExpiresIn ?? DEFAULT_JWT_EXPIRES_IN) as jwt.SignOptions['expiresIn'];

  router.post('/auth/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const user = await User.findOne({ uname: parsed.data.uname, passwordHash: { $exists: true } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { sub: user._id.toString(), roleTypeId: user.roleTypeId, uname: user.uname },
      deps.jwtSecret,
      { expiresIn }
    );

    res.json({
      token,
      mustResetPassword: Boolean(user.mustResetPassword),
      user: { id: user._id.toString(), uname: user.uname, roleTypeId: user.roleTypeId }
    });
  });

  /** Issue a new token when the current one is still valid (extends session / "stay logged in"). */
  router.post('/auth/refresh', deps.requireAuth, async (req, res) => {
    const auth = (req as any).auth as AuthPayload;
    const user = await User.findById(auth.sub).select('mustResetPassword').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const token = jwt.sign(
      { sub: auth.sub, roleTypeId: auth.roleTypeId, uname: auth.uname },
      deps.jwtSecret,
      { expiresIn }
    );

    res.json({
      token,
      mustResetPassword: Boolean(user.mustResetPassword)
    });
  });

  // Registration is by admin invitation only; new accounts are created via POST /users.
  router.post('/auth/register', async (_req, res) => {
    return res.status(403).json({
      error: 'Registration is by invitation only. Contact your administrator for access.'
    });
  });

  router.post('/auth/forgot-password', async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    const email = parsed.data.email.trim();
    const user = await User.findOne({
      email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      passwordHash: { $exists: true }
    }).lean<UserDoc>();
    if (!user) {
      res.json({ ok: true });
      return;
    }
    if (user.email && user.email.endsWith('@placeholder.local')) {
      res.json({ ok: true });
      return;
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_EXPIRY_MS);
    const userId = (user as UserDoc & { _id: mongoose.Types.ObjectId })._id;
    await User.updateOne(
      { _id: userId },
      { $set: { passwordResetToken: token, passwordResetTokenExpiresAt: expiresAt } }
    );
    const appUrl = (process.env.APP_BASE_URL?.trim() || 'http://localhost:4200').replace(/\/+$/, '');
    try {
      await sendPasswordResetEmail({ to: user.email, appUrl, resetToken: token });
    } catch (e) {
      console.warn('[forgot-password] Failed to send reset email:', e);
    }
    res.json({ ok: true });
  });

  router.post('/auth/reset-password', async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request. Token and new password (min 8 characters) are required.' });
    }
    const { token, newPassword } = parsed.data;
    const now = new Date();
    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetTokenExpiresAt: { $gt: now },
      passwordHash: { $exists: true }
    }).lean<UserDoc>();
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new password reset.' });
    }
    const userId = (user as UserDoc & { _id: mongoose.Types.ObjectId })._id;
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await User.updateOne(
      { _id: userId },
      {
        $set: { passwordHash, mustResetPassword: false, updatedBy: userId },
        $unset: { passwordResetToken: '', passwordResetTokenExpiresAt: '' }
      }
    );
    res.json({ ok: true });
  });

  router.post('/auth/change-password', deps.requireAuth, async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const auth = (req as any).auth as AuthPayload;

    const user = await User.findById(auth.sub).lean<UserDoc>();
    if (!user) return res.status(404).json({ error: 'Not found' });

    // Enforce actual password rotation: do not allow reusing the current password.
    if (user.passwordHash) {
      const isSame = await bcrypt.compare(parsed.data.newPassword, user.passwordHash);
      if (isSame) {
        return res.status(400).json({ error: 'New password must be different from the current password' });
      }
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await User.updateOne({ _id: auth.sub }, { $set: { passwordHash, mustResetPassword: false, updatedBy: auth.sub } });

    res.json({ ok: true });
  });

  router.get('/me', deps.requireAuth, async (req, res) => {
    const auth = (req as any).auth as AuthPayload;
    const user = await User.findById(auth.sub).lean<UserDoc>();
    if (!user) return res.status(404).json({ error: 'Not found' });

    // Legacy support: if this user still has a plaintext SSN field and no ssnLast4,
    // compute last4 for display without exposing the full SSN.
    const maybeLegacySsnRaw =
      (user as any).ssn ?? (user as any).SSN ?? (user as any).Ssn ?? (user as any).socialSecurity;
    const maybeLegacySsn =
      typeof maybeLegacySsnRaw === 'string'
        ? maybeLegacySsnRaw.trim()
        : typeof maybeLegacySsnRaw === 'number'
          ? String(maybeLegacySsnRaw)
          : '';

    const legacyLast4 = maybeLegacySsn ? computeSsnLast4(maybeLegacySsn) : undefined;
    const dto = toUserDTO({ ...user, _id: auth.sub });
    res.json({ ...dto, ...(dto.ssnLast4 ? {} : legacyLast4 ? { ssnLast4: legacyLast4 } : {}) });
  });

  router.patch('/me', deps.requireAuth, async (req, res) => {
    const auth = (req as any).auth as AuthPayload;
    const parsed = meUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const user = await User.findById(auth.sub).lean<UserDoc>();
    if (!user) return res.status(404).json({ error: 'Not found' });

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, unknown> = {};

    const setOrUnsetTrimmed = (key: string, raw: string | undefined) => {
      if (raw === undefined) return;
      const v = raw.trim();
      if (v) {
        $set[key] = v;
      } else {
        $unset[key] = '';
      }
    };

    if (parsed.data.email !== undefined) {
      const email = parsed.data.email.trim();
      if (email && email !== user.email) {
        const existingEmail = await User.findOne({ email }).lean();
        if (existingEmail) return res.status(409).json({ error: 'Email already exists' });
        $set.email = email;
      }
    }

    setOrUnsetTrimmed('firstName', parsed.data.firstName);
    setOrUnsetTrimmed('lastName', parsed.data.lastName);
    if (parsed.data.gender !== undefined) {
      const v = parsed.data.gender?.trim();
      if (v) $set.gender = v;
      else $unset.gender = '';
    }
    if (parsed.data.dateOfBirth !== undefined) {
      const v = parsed.data.dateOfBirth?.trim();
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        $set.dateOfBirth = new Date(v + 'T00:00:00.000Z');
      } else {
        $unset.dateOfBirth = '';
      }
    }
    setOrUnsetTrimmed('addressLine1', parsed.data.addressLine1);
    setOrUnsetTrimmed('addressLine2', parsed.data.addressLine2);
    setOrUnsetTrimmed('city', parsed.data.city);
    setOrUnsetTrimmed('state', parsed.data.state);
    setOrUnsetTrimmed('zipCode', parsed.data.zipCode);
    setOrUnsetTrimmed('phone', parsed.data.phone);

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      return res.json(toUserDTO({ ...user, _id: auth.sub }));
    }

    // Audit: any self-update marks updatedBy.
    $set.updatedBy = auth.sub;

    await User.updateOne(
      { _id: auth.sub },
      {
        ...(Object.keys($set).length > 0 ? { $set } : {}),
        ...(Object.keys($unset).length > 0 ? { $unset } : {})
      }
    );

    const updated = await User.findById(auth.sub).lean<UserDoc>();
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(toUserDTO({ ...updated, _id: auth.sub }));
  });

  router.get('/me/ssn', deps.requireAuth, async (req, res) => {
    const auth = (req as any).auth as AuthPayload;
    const user = await User.findById(auth.sub).lean<UserDoc>();
    if (!user) return res.status(404).json({ error: 'Not found' });

    const enc = {
      ssnCiphertextB64: (user as any).ssnCiphertextB64,
      ssnIvB64: (user as any).ssnIvB64,
      ssnAuthTagB64: (user as any).ssnAuthTagB64
    };

    // Legacy support: some older users may have a plaintext `ssn` field.
    // If present, migrate it to encrypted form on-demand.
    if (!enc.ssnCiphertextB64 || !enc.ssnIvB64 || !enc.ssnAuthTagB64) {
      const legacyRaw =
        (user as any).ssn ?? (user as any).SSN ?? (user as any).Ssn ?? (user as any).socialSecurity;
      const legacySsn =
        typeof legacyRaw === 'string'
          ? legacyRaw.trim()
          : typeof legacyRaw === 'number'
            ? String(legacyRaw)
            : '';
      if (legacySsn) {
        let encryptedSsn: ReturnType<typeof encryptSsn>;
        try {
          encryptedSsn = encryptSsn(legacySsn);
        } catch {
          return res
            .status(500)
            .json({ error: 'Server not configured for SSN encryption (missing SSN_ENCRYPTION_KEY_B64)' });
        }

        await User.updateOne(
          { _id: auth.sub },
          {
            $set: {
              ssnLast4: computeSsnLast4(legacySsn),
              ...encryptedSsn,
						updatedBy: auth.sub
            },
            $unset: {
              ssn: '',
              SSN: '',
              Ssn: '',
              socialSecurity: ''
            }
          }
        );

        const migrated = await User.findById(auth.sub).lean<UserDoc>();
        if (!migrated) return res.status(404).json({ error: 'Not found' });

        const migratedEnc = {
          ssnCiphertextB64: (migrated as any).ssnCiphertextB64,
          ssnIvB64: (migrated as any).ssnIvB64,
          ssnAuthTagB64: (migrated as any).ssnAuthTagB64
        };

        if (!migratedEnc.ssnCiphertextB64 || !migratedEnc.ssnIvB64 || !migratedEnc.ssnAuthTagB64) {
          return res.status(500).json({ error: 'Unable to migrate SSN' });
        }

        try {
          const ssn = decryptSsn(migratedEnc);
          return res.json({ ssn, ssnLast4: (migrated as any).ssnLast4 ?? undefined });
        } catch {
          return res.status(500).json({ error: 'Unable to decrypt SSN' });
        }
      }
    }

    if (!enc.ssnCiphertextB64 || !enc.ssnIvB64 || !enc.ssnAuthTagB64) {
      return res.status(404).json({ error: 'SSN not set' });
    }

    try {
      const ssn = decryptSsn(enc);
      res.json({ ssn, ssnLast4: (user as any).ssnLast4 ?? undefined });
    } catch {
      res.status(500).json({ error: 'Unable to decrypt SSN' });
    }
  });

  router.patch('/me/ssn', deps.requireAuth, async (req, res) => {
    const auth = (req as any).auth as AuthPayload;
    const parsed = meSsnUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const ssn = parsed.data.ssn.trim();
    let encryptedSsn: ReturnType<typeof encryptSsn>;
    try {
      encryptedSsn = encryptSsn(ssn);
    } catch {
      return res
        .status(500)
        .json({ error: 'Server not configured for SSN encryption (missing SSN_ENCRYPTION_KEY_B64)' });
    }

    await User.updateOne(
      { _id: auth.sub },
      {
        $set: {
          ssnLast4: computeSsnLast4(ssn),
          ...encryptedSsn,
					updatedBy: auth.sub
        }
      }
    );

    const updated = await User.findById(auth.sub).lean<UserDoc>();
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(toUserDTO({ ...updated, _id: auth.sub }));
  });

  return router;
}
