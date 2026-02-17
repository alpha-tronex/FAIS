import express from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { User, type UserDoc } from '../models.js';
import { toUserDTO, toNormalizedUserUpdate } from '../mappers/user.mapper.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';
import { computeSsnLast4, decryptSsn, encryptSsn } from '../security/ssn-crypto.js';
import { sendInviteEmail } from '../services/invite-email.service.js';

const userCreateSchema = z.object({
  uname: z.string().min(1).max(25),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional()
});

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

export function createUsersRouter(auth: Pick<AuthMiddlewares, 'requireAuth' | 'requireAdmin'>): express.Router {
  const router = express.Router();

  router.get('/users', auth.requireAuth, async (_req, res) => {
    const users = await User.find({ passwordHash: { $exists: true } })
      .select({ uname: 1, email: 1, firstName: 1, lastName: 1, roleTypeId: 1, mustResetPassword: 1 })
      .sort({ lastName: 1, firstName: 1, uname: 1 })
      .lean();

    res.json(users.map((u) => toUserDTO(u)));
  });

  router.post('/users', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const parsed = userCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

    const existingUname = await User.findOne({ uname: parsed.data.uname }).lean();
    if (existingUname) return res.status(409).json({ error: 'Username already exists' });
    const existingEmail = await User.findOne({ email: parsed.data.email }).lean();
    if (existingEmail) return res.status(409).json({ error: 'Email already exists' });

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const roleTypeId = 1;
    const created = await User.create({
      uname: parsed.data.uname,
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      roleTypeId,
      passwordHash,
      mustResetPassword: true,
			createdBy: authPayload?.sub,
			updatedBy: authPayload?.sub
    });

    const appUrl = (process.env.APP_BASE_URL?.trim() || 'http://localhost:4200').replace(/\/+$/, '');
    try {
      await sendInviteEmail({
        to: parsed.data.email,
        uname: parsed.data.uname,
        password: parsed.data.password,
        appUrl
      });
    } catch (e) {
      // Don't fail user creation if email sending is misconfigured.
      console.warn('[invite-email] Failed to send invite email:', e);
    }

    res.status(201).json({
      id: created._id.toString(),
      uname: created.uname
    });
  });

  router.get('/users/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, passwordHash: { $exists: true } })
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
    const user = await User.findOne({ _id: req.params.id, passwordHash: { $exists: true } }).lean<UserDoc>();
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
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const user = await User.findOne({ _id: req.params.id, passwordHash: { $exists: true } }).lean<UserDoc>();
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
      { _id: req.params.id, passwordHash: { $exists: true } },
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
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    if (parsed.data.email) {
      const existingEmail = await User.findOne({ email: parsed.data.email, _id: { $ne: req.params.id } }).lean();
      if (existingEmail) return res.status(409).json({ error: 'Email already exists' });
    }

    const updated = await User.findOneAndUpdate(
      { _id: req.params.id, passwordHash: { $exists: true } },
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
