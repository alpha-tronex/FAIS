import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User, type UserDoc } from '../models.js';
import { toUserDTO } from '../mappers/user.mapper.js';
import { computeSsnLast4, decryptSsn, encryptSsn } from '../security/ssn-crypto.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';

const loginSchema = z.object({
  uname: z.string().min(1).max(25),
  password: z.string().min(1)
});

const registerSchema = z.object({
  uname: z.string().min(1).max(25),
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  zipCode: z.string().min(1).max(20),
  phone: z.string().min(1).max(50),
  ssn: z.string().min(1).max(20),
  // Ignored on create; server forces roleTypeId=1.
  roleTypeId: z.number().int().optional(),
  // Ignored on create; server forces mustResetPassword=false.
  mustResetPassword: z.boolean().optional()
});

const changePasswordSchema = z.object({
  newPassword: z.string().min(8)
});

const meUpdateSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
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

export function createAuthRouter(
  deps: { jwtSecret: string } & Pick<AuthMiddlewares, 'requireAuth'>
): express.Router {
  const router = express.Router();

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
      { expiresIn: '15m' }
    );

    res.json({
      token,
      mustResetPassword: Boolean(user.mustResetPassword),
      user: { id: user._id.toString(), uname: user.uname, roleTypeId: user.roleTypeId }
    });
  });

  // Self-registration: creates a standard user account (roleTypeId=1).
  router.post('/auth/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const uname = parsed.data.uname.trim();
    const email = parsed.data.email.trim();
    const firstName = parsed.data.firstName?.trim() || undefined;
    const lastName = parsed.data.lastName?.trim() || undefined;
    const addressLine1 = parsed.data.addressLine1.trim();
    const addressLine2 = parsed.data.addressLine2?.trim() || undefined;
    const city = parsed.data.city.trim();
    const state = parsed.data.state.trim();
    const zipCode = parsed.data.zipCode.trim();
    const phone = parsed.data.phone.trim();
    const ssn = parsed.data.ssn.trim();
    let encryptedSsn: ReturnType<typeof encryptSsn>;
    try {
      encryptedSsn = encryptSsn(ssn);
    } catch {
      return res
        .status(500)
        .json({ error: 'Server not configured for SSN encryption (missing SSN_ENCRYPTION_KEY_B64)' });
    }

    const existingUname = await User.findOne({ uname }).lean();
    if (existingUname) return res.status(409).json({ error: 'Username already exists' });
    const existingEmail = await User.findOne({ email }).lean();
    if (existingEmail) return res.status(409).json({ error: 'Email already exists' });

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const created = await User.create({
      uname,
      email,
      firstName,
      lastName,
      addressLine1,
      addressLine2,
      city,
      state,
      zipCode,
      phone,
      ssnLast4: computeSsnLast4(ssn),
      ...encryptedSsn,
      roleTypeId: 1,
      passwordHash,
      mustResetPassword: false
    });

    // Self-registration: audit fields point to the created user.
    await User.updateOne({ _id: created._id }, { $set: { createdBy: created._id, updatedBy: created._id } });

    const token = jwt.sign(
      { sub: created._id.toString(), roleTypeId: created.roleTypeId, uname: created.uname },
      deps.jwtSecret,
      { expiresIn: '15m' }
    );

    res.status(201).json({
      token,
      mustResetPassword: false,
      user: { id: created._id.toString(), uname: created.uname, roleTypeId: created.roleTypeId }
    });
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
