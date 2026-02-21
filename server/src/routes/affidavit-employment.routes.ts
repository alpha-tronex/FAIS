import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  userScopedFilter,
  listAffidavitRows,
  insertAffidavitRow,
  deleteAffidavitRow,
  patchAffidavitRow
} from '../lib/affidavit-store.js';
import { resolveAffidavitTarget } from './affidavit-middleware.js';
import { sendError } from './error.js';
import type { AuthMiddlewares } from './middleware.js';

const employmentCreateSchema = z.object({
  name: z.string().min(1).max(200),
  occupation: z.string().optional(),
  payRate: z.number().finite().nonnegative(),
  payFrequencyTypeId: z.number().int().min(1).max(999),
  payFrequencyIfOther: z.string().optional(),
  retired: z.boolean().optional()
});

const employmentPatchSchema = employmentCreateSchema
  .partial()
  .refine((x) => Object.keys(x).length > 0, { message: 'Invalid payload' });

export function createAffidavitEmploymentRouter(authMw: Pick<AuthMiddlewares, 'requireAuth'>): express.Router {
  const router = express.Router({ mergeParams: true });

  router.get('/', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const rows = await listAffidavitRows('employment', userScopedFilter(targetUserObjectId));
      res.json(
        rows.map((r: any) => ({
          id: r._id?.toString?.() ?? '',
          name: r.name ?? '',
          occupation: r.occupation ?? null,
          payRate: r.payRate ?? 0,
          payFrequencyTypeId: r.payFrequencyTypeId ?? null,
          payFrequencyIfOther: r.payFrequencyIfOther ?? null,
          retired: r.retired ?? false
        }))
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post('/', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = employmentCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const doc: any = {
        userId: new mongoose.Types.ObjectId(targetUserObjectId),
        name: parsed.data.name,
        occupation: parsed.data.occupation,
        payRate: parsed.data.payRate,
        payFrequencyTypeId: parsed.data.payFrequencyTypeId,
        payFrequencyIfOther: parsed.data.payFrequencyIfOther,
        retired: parsed.data.retired ?? false,
        createdAt: new Date()
      };

      const id = await insertAffidavitRow('employment', doc);
      res.status(201).json({ id });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.delete('/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const ok = await deleteAffidavitRow('employment', String((req.params as any).id), userScopedFilter(targetUserObjectId));
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.patch('/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = employmentPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const set: any = { updatedAt: new Date() };
      if (parsed.data.name != null) set.name = parsed.data.name;
      if (parsed.data.occupation !== undefined) set.occupation = parsed.data.occupation;
      if (parsed.data.payRate != null) set.payRate = parsed.data.payRate;
      if (parsed.data.payFrequencyTypeId != null) set.payFrequencyTypeId = parsed.data.payFrequencyTypeId;
      if (parsed.data.payFrequencyIfOther !== undefined) set.payFrequencyIfOther = parsed.data.payFrequencyIfOther;
      if (parsed.data.retired !== undefined) set.retired = parsed.data.retired;

      const ok = await patchAffidavitRow('employment', String((req.params as any).id), userScopedFilter(targetUserObjectId), set);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  return router;
}
