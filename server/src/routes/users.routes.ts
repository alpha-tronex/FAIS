import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { User, type UserDoc } from '../models.js';
import { toUserDTO, toNormalizedUserUpdate } from '../mappers/user.mapper.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';
import { computeSsnLast4, decryptSsn, encryptSsn } from '../security/ssn-crypto.js';
import { sendInviteEmail, sendPasswordResetEmail } from '../services/invite-email.service.js';

const PASSWORD_RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/** Full create: uname, email, password required. Minimal create: only firstName, lastName, roleTypeId (2 or 4). */
const userCreateSchema = z
  .object({
    uname: z.string().min(1).max(25).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).max(200).optional(),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    roleTypeId: z.number().int().min(1).max(5).optional(),
    /** When true, send invitation email. Only used for full create. */
    sendInviteEmail: z.boolean().optional()
  })
  .refine(
    (data) => {
      const hasPassword = typeof data.password === 'string' && data.password.length >= 8;
      const hasUname = typeof data.uname === 'string' && data.uname.trim().length > 0;
      const hasEmail = typeof data.email === 'string' && data.email.length > 0;
      if (hasPassword) return hasUname && hasEmail;
      const minimal = (data.roleTypeId === 2 || data.roleTypeId === 4) && data.firstName?.trim() && data.lastName?.trim();
      return !!minimal;
    },
    { message: 'Either provide uname, email, and password (full create), or firstName, lastName, and roleTypeId 2 or 4 (minimal create).' }
  );

const userUpdateSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  addressLine1: z.string().min(1).max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(50).optional(),
  zipCode: z.string().min(1).max(20).optional(),
  phone: z.string().min(1).max(50).optional(),
  roleTypeId: z.number().int().min(1).max(99).optional()
});

const userSsnUpdateSchema = z
  .object({
    ssn: z.string().min(1).max(20),
    confirmSsn: z.string().min(1).max(20)
  })
  .refine((v) => v.ssn.trim() === v.confirmSsn.trim(), {
    message: 'SSNs do not match',
    path: ['confirmSsn']
  });

/** Generate unique placeholder uname and email for minimal users (no login). */
function generateMinimalCredentials(): { uname: string; email: string } {
  const suffix = crypto.randomBytes(8).toString('hex');
  return {
    uname: `minimal-${suffix}`,
    email: `minimal-${suffix}@placeholder.local`
  };
}

/** Turn zod validation errors into a single user-friendly message. */
function formatValidationMessage(flattened: { formErrors: string[]; fieldErrors: Record<string, string[]> }): string {
  const form = flattened.formErrors.filter(Boolean);
  const field = Object.entries(flattened.fieldErrors)
    .map(([k, v]) => (v && v[0]) ? `${k}: ${v[0]}` : k)
    .filter(Boolean);
  const first = form[0] ?? field[0];
  return first ?? 'Please check the form and try again.';
}

export function createUsersRouter(auth: Pick<AuthMiddlewares, 'requireAuth' | 'requireAdmin'>): express.Router {
  const router = express.Router();

  router.get('/users', auth.requireAuth, async (_req, res) => {
    const users = await User.find({})
      .select({ uname: 1, email: 1, firstName: 1, lastName: 1, roleTypeId: 1, mustResetPassword: 1 })
      .sort({ lastName: 1, firstName: 1, uname: 1 })
      .lean();

    res.json(users.map((u) => toUserDTO(u)));
  });

  router.post('/users', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const parsed = userCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      return res.status(400).json({ error: formatValidationMessage(flattened), details: flattened });
    }

    const isMinimal =
      !parsed.data.password &&
      (parsed.data.roleTypeId === 2 || parsed.data.roleTypeId === 4) &&
      parsed.data.firstName?.trim() &&
      parsed.data.lastName?.trim();

    if (isMinimal) {
      const { uname, email } = generateMinimalCredentials();
      const created = await User.create({
        uname,
        email,
        firstName: parsed.data.firstName!.trim(),
        lastName: parsed.data.lastName!.trim(),
        roleTypeId: parsed.data.roleTypeId!,
        createdBy: authPayload?.sub,
        updatedBy: authPayload?.sub
      });
      return res.status(201).json({
        id: created._id.toString(),
        uname: created.uname
      });
    }

    const uname = parsed.data.uname!.trim();
    const email = parsed.data.email!.trim();
    const password = parsed.data.password!;
    const existingUname = await User.findOne({ uname }).lean();
    if (existingUname) return res.status(409).json({ error: 'Username already exists' });
    const existingEmail = await User.findOne({ email }).lean();
    if (existingEmail) return res.status(409).json({ error: 'Email already exists' });

    const roleTypeId = Math.min(4, Math.max(1, Number(parsed.data.roleTypeId) || 1));
    if (roleTypeId === 5) return res.status(400).json({ error: 'Cannot create administrator users via this endpoint.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await User.create({
      uname,
      email,
      firstName: parsed.data.firstName?.trim(),
      lastName: parsed.data.lastName?.trim(),
      roleTypeId,
      passwordHash,
      mustResetPassword: true,
      createdBy: authPayload?.sub,
      updatedBy: authPayload?.sub
    });

    if (parsed.data.sendInviteEmail === true) {
      const appUrl = (process.env.APP_BASE_URL?.trim() || 'http://localhost:4200').replace(/\/+$/, '');
      try {
        await sendInviteEmail({
          to: email,
          uname,
          password,
          appUrl
        });
      } catch (e) {
        console.warn('[invite-email] Failed to send invite email:', e);
      }
    }

    res.status(201).json({
      id: created._id.toString(),
      uname: created.uname
    });
  });

  router.post('/users/:id/send-password-reset', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const user = await User.findOne({ _id: req.params.id })
      .select({ email: 1, passwordHash: 1 })
      .lean<UserDoc>();
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (!user.passwordHash) {
      return res.status(400).json({ error: 'This user has no password set. They cannot receive a password reset.' });
    }
    const email = (user.email ?? '').trim();
    if (!email || email.endsWith('@placeholder.local')) {
      return res.status(400).json({ error: 'This user has no valid email address for sending a password reset.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_EXPIRY_MS);
    await User.updateOne(
      { _id: req.params.id },
      { $set: { passwordResetToken: token, passwordResetTokenExpiresAt: expiresAt } }
    );
    const appUrl = (process.env.APP_BASE_URL?.trim() || 'http://localhost:4200').replace(/\/+$/, '');
    try {
      await sendPasswordResetEmail({ to: email, appUrl, resetToken: token });
    } catch (e) {
      console.warn('[send-password-reset] Failed to send email:', e);
      return res.status(500).json({ error: 'Failed to send email. Please try again or check server configuration.' });
    }
    res.json({ ok: true });
  });

  router.get('/users/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const user = await User.findOne({ _id: req.params.id })
      .select({
        uname: 1,
        email: 1,
        firstName: 1,
        lastName: 1,
        addressLine1: 1,
        addressLine2: 1,
        city: 1,
        state: 1,
        zipCode: 1,
        phone: 1,
        ssnLast4: 1,
        roleTypeId: 1,
        mustResetPassword: 1
      })
      .lean<UserDoc>();
    if (!user) return res.status(404).json({ error: 'Not found' });

    res.json(toUserDTO(user));
  });

  router.get('/users/:id/ssn', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const user = await User.findOne({ _id: req.params.id }).lean<UserDoc>();
    if (!user) return res.status(404).json({ error: 'Not found' });

    const maybeLegacySsnRaw =
      (user as any).ssn ?? (user as any).SSN ?? (user as any).Ssn ?? (user as any).socialSecurity;
    const maybeLegacySsn =
      typeof maybeLegacySsnRaw === 'string'
        ? maybeLegacySsnRaw.trim()
        : typeof maybeLegacySsnRaw === 'number'
          ? String(maybeLegacySsnRaw)
          : '';

    if (maybeLegacySsn) {
      return res.json({ ssn: maybeLegacySsn, ssnLast4: computeSsnLast4(maybeLegacySsn) });
    }

    try {
      const ssn = decryptSsn(user as any);
      return res.json({ ssn, ssnLast4: computeSsnLast4(ssn) });
    } catch {
      return res
        .status(500)
        .json({ error: 'Server not configured for SSN decryption (missing SSN_ENCRYPTION_KEY_B64)' });
    }
  });

  router.patch('/users/:id/ssn', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const parsed = userSsnUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      return res.status(400).json({ error: formatValidationMessage(flattened), details: flattened });
    }

    const user = await User.findOne({ _id: req.params.id }).lean<UserDoc>();
    if (!user) return res.status(404).json({ error: 'Not found' });

    const ssn = parsed.data.ssn.trim();
    let encrypted: ReturnType<typeof encryptSsn>;
    try {
      encrypted = encryptSsn(ssn);
    } catch {
      return res
        .status(500)
        .json({ error: 'Server not configured for SSN encryption (missing SSN_ENCRYPTION_KEY_B64)' });
    }

    const updated = await User.findOneAndUpdate(
      { _id: req.params.id },
      {
        $set: {
          ssnLast4: computeSsnLast4(ssn),
          ...encrypted,
          updatedBy: authPayload?.sub
        },
        $unset: {
          ssn: '',
          SSN: '',
          Ssn: '',
          socialSecurity: ''
        }
      },
      { new: true }
    )
      .select({
				uname: 1,
				email: 1,
				firstName: 1,
				lastName: 1,
				addressLine1: 1,
				addressLine2: 1,
				city: 1,
				state: 1,
				zipCode: 1,
				phone: 1,
				ssnLast4: 1,
				roleTypeId: 1,
				mustResetPassword: 1
			})
      .lean<UserDoc>();
    if (!updated) return res.status(404).json({ error: 'Not found' });

    res.json(toUserDTO(updated));
  });

  router.patch('/users/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const parsed = userUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      return res.status(400).json({ error: formatValidationMessage(flattened), details: flattened });
    }

    if (parsed.data.email) {
      const existingEmail = await User.findOne({ email: parsed.data.email, _id: { $ne: req.params.id } }).lean();
      if (existingEmail) return res.status(409).json({ error: 'Email already exists' });
    }

    const updated = await User.findOneAndUpdate(
      { _id: req.params.id },
      { $set: { ...toNormalizedUserUpdate(parsed.data), updatedBy: authPayload?.sub } },
      { new: true }
    )
      .select({
        uname: 1,
        email: 1,
        firstName: 1,
        lastName: 1,
        addressLine1: 1,
        addressLine2: 1,
        city: 1,
        state: 1,
        zipCode: 1,
        phone: 1,
        ssnLast4: 1,
        roleTypeId: 1,
        mustResetPassword: 1
      })
      .lean<UserDoc>();
    if (!updated) return res.status(404).json({ error: 'Not found' });

    res.json(toUserDTO(updated));
  });

  return router;
}
