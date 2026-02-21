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
import { asFiniteNumber } from '../lib/number.js';

const liabilitiesCreateSchema = z.object({
  liabilitiesTypeId: z.number().int().min(1).max(999),
  description: z.string().min(1).max(500),
  amountOwed: z.number().finite().nonnegative(),
  nonMaritalTypeId: z.number().int().min(1).max(999).optional(),
  userOwes: z.boolean().optional()
});

const liabilitiesPatchSchema = liabilitiesCreateSchema
  .partial()
  .refine((x) => Object.keys(x).length > 0, { message: 'Invalid payload' });

export function createAffidavitLiabilitiesRouter(authMw: Pick<AuthMiddlewares, 'requireAuth'>): express.Router {
  const router = express.Router({ mergeParams: true });

  router.get('/', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const rows = await listAffidavitRows('liabilities', userScopedFilter(targetUserObjectId));
      res.json(
        rows.map((r: any) => ({
          id: r._id?.toString?.() ?? '',
          liabilitiesTypeId: asFiniteNumber(r.liabilitiesTypeId) ?? null,
          description: r.description ?? '',
          amountOwed: Number(r.amountOwed ?? 0),
          nonMaritalTypeId: asFiniteNumber(r.nonMaritalTypeId) ?? null,
          userOwes: Boolean(r.userOwes ?? false)
        }))
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post('/', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = liabilitiesCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const doc: any = {
        userId: new mongoose.Types.ObjectId(targetUserObjectId),
        liabilitiesTypeId: parsed.data.liabilitiesTypeId,
        description: parsed.data.description,
        amountOwed: parsed.data.amountOwed,
        nonMaritalTypeId: parsed.data.nonMaritalTypeId ?? null,
        userOwes: parsed.data.userOwes ?? true,
        createdAt: new Date()
      };
      const id = await insertAffidavitRow('liabilities', doc);
      res.status(201).json({ id });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.delete('/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const ok = await deleteAffidavitRow('liabilities', String((req.params as any).id), userScopedFilter(targetUserObjectId));
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.patch('/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = liabilitiesPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const set: any = { updatedAt: new Date() };
      if (parsed.data.liabilitiesTypeId != null) set.liabilitiesTypeId = parsed.data.liabilitiesTypeId;
      if (parsed.data.description != null) set.description = parsed.data.description;
      if (parsed.data.amountOwed != null) set.amountOwed = parsed.data.amountOwed;
      if (parsed.data.nonMaritalTypeId !== undefined) set.nonMaritalTypeId = parsed.data.nonMaritalTypeId ?? null;
      if (parsed.data.userOwes !== undefined) set.userOwes = parsed.data.userOwes ?? true;

      const ok = await patchAffidavitRow('liabilities', String((req.params as any).id), userScopedFilter(targetUserObjectId), set);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  return router;
}
