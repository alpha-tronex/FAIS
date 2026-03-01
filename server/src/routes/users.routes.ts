import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import OpenAI from 'openai';
import { User, type UserDoc } from '../models.js';
import { toUserDTO, toNormalizedUserUpdate } from '../mappers/user.mapper.js';
import { sendError } from './error.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';
import { computeSsnLast4, decryptSsn, encryptSsn } from '../security/ssn-crypto.js';
import { sendInviteEmail, sendPasswordResetEmail } from '../services/invite-email.service.js';
import { getOpenAIClient } from '../lib/openai.js';

const PASSWORD_RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/** Full create: uname, email, password required. Minimal create: only firstName, lastName, roleTypeId (2 or 4). */
const userCreateSchema = z
  .object({
    uname: z.string().min(1).max(25).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).max(200).optional(),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    roleTypeId: z.number().int().min(1).max(6).optional(),
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
  gender: z.string().max(50).optional(),
  dateOfBirth: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
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

/** Slugify a name for use in minimal username: lowercase, hyphens, alphanumeric only. */
function slugifyName(name: string): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Generate unique uname (m-firstname-lastname, with -1, -2 for duplicates) and matching placeholder email for minimal users. */
async function generateMinimalCredentials(
  firstName: string | undefined,
  lastName: string | undefined
): Promise<{ uname: string; email: string }> {
  const first = slugifyName(firstName ?? '');
  const last = slugifyName(lastName ?? '');
  const base =
    last && first
      ? `m-${first}-${last}`
      : last
        ? `m-${last}`
        : first
          ? `m-${first}`
          : null;
  let uname: string;
  if (base) {
    uname = base;
    let n = 0;
    while (await User.findOne({ uname }).select({ _id: 1 }).lean()) {
      n++;
      uname = `${base}-${n}`;
    }
  } else {
    uname = `minimal-${crypto.randomBytes(8).toString('hex')}`;
  }
  const email = `${uname}@placeholder.local`;
  return { uname, email };
}

const createFromPromptSchema = z.object({
  prompt: z.string().min(1)
});

const CREATE_MINIMAL_USER_SYSTEM = `You must output only valid JSON with these keys: firstName, lastName, roleTypeId.
- firstName: string, the person's first name (e.g. "Jim" from "Jim Kelly", "Ally" from "Ally Vitale"). Never omit the first name when two names are given.
- lastName: string, the person's last name (e.g. "Kelly", "Vitale"). If only one name is given, set firstName to empty string and use that name as lastName.
- roleTypeId: number, 2 for respondent (or "respondent party", "respondend"), 4 for respondent attorney.
Interpret "add respondent Ally Vitale" as firstName: "Ally", lastName: "Vitale", roleTypeId: 2. Output no other keys and no markdown or explanation.`;

type CreateFromPromptParams = {
  firstName: string;
  lastName: string;
  roleTypeId: 2 | 4;
};

function parseCreateFromPromptResponse(text: string): CreateFromPromptParams | null {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    let firstName = typeof obj.firstName === 'string' ? obj.firstName.trim() : '';
    let lastName = typeof obj.lastName === 'string' ? obj.lastName.trim() : '';
    const roleTypeId = obj.roleTypeId === 4 ? 4 : 2;
    if (!lastName && !firstName) return null;
    if (!lastName && firstName) return { firstName: '', lastName: firstName, roleTypeId };
    // If LLM put full name in lastName only (e.g. "Ally Vitale"), split into first + last
    if (!firstName && lastName && lastName.includes(' ')) {
      const parts = lastName.split(/\s+/);
      firstName = parts[0].trim();
      lastName = parts.slice(1).join(' ').trim() || firstName;
    }
    return { firstName, lastName, roleTypeId };
  } catch {
    return null;
  }
}

async function callLLM(client: OpenAI, system: string, userPrompt: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 128
  });
  const content = completion.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
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
      const { uname, email } = await generateMinimalCredentials(
        parsed.data.firstName?.trim(),
        parsed.data.lastName?.trim()
      );
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

  router.post('/users/create-from-prompt', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const bodyParsed = createFromPromptSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Prompt is required.', details: bodyParsed.error.flatten() });
    }
    const prompt = bodyParsed.data.prompt.trim();

    const client = getOpenAIClient();
    if (!client) {
      return res.status(503).json({
        error: 'AI create-from-prompt is not configured. Set OPENAI_API_KEY in server environment.'
      });
    }

    let params: CreateFromPromptParams | null;
    try {
      const raw = await callLLM(client, CREATE_MINIMAL_USER_SYSTEM, prompt);
      params = parseCreateFromPromptResponse(raw);
      if (!params) {
        return res.status(400).json({
          error:
            'Could not understand the request. Try something like "create respondent Jim Kelly" or "add respondent attorney Jane Doe".'
        });
      }
    } catch (e) {
      const err = e as { status?: number };
      if (err?.status === 429 || err?.status === 402) {
        return res.status(err.status).json({ error: 'AI quota exceeded. Check your OpenAI plan and billing.' });
      }
      return sendError(res, e);
    }

    const { uname, email } = await generateMinimalCredentials(params.firstName, params.lastName);
    const created = await User.create({
      uname,
      email,
      firstName: params.firstName || undefined,
      lastName: params.lastName,
      roleTypeId: params.roleTypeId,
      createdBy: (req as any).auth?.sub,
      updatedBy: (req as any).auth?.sub
    });

    return res.status(201).json({
      id: created._id.toString(),
      firstName: created.firstName,
      lastName: created.lastName,
      roleTypeId: created.roleTypeId
    });
  });

  /** Delete a user. Only allowed for minimal users (placeholder email, no login). Used for "undo" after create-from-prompt. */
  router.delete('/users/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const user = await User.findOne({ _id: req.params.id })
      .select({ email: 1, passwordHash: 1 })
      .lean<UserDoc>();
    if (!user) return res.status(404).json({ error: 'Not found' });
    const email = (user.email ?? '').trim();
    const isMinimal =
      (email.endsWith('@placeholder.local') || !email) && !(user as any).passwordHash;
    if (!isMinimal) {
      return res.status(403).json({
        error: 'Only minimal users (no login) can be deleted. Use the full user management flow for other users.'
      });
    }
    await User.deleteOne({ _id: req.params.id });
    return res.json({ ok: true });
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
        gender: 1,
        dateOfBirth: 1,
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
        gender: 1,
        dateOfBirth: 1,
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
