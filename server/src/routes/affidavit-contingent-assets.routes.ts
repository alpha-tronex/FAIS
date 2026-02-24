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

const createSchema = z.object({
  description: z.string().min(1).max(500),
  possibleValue: z.number().finite().nonnegative(),
  nonMaritalTypeId: z.number().int().min(1).max(999).optional(),
  judgeAward: z.boolean().optional()
});

const patchSchema = createSchema
  .partial()
  .refine((x) => Object.keys(x).length > 0, { message: 'Invalid payload' });

const COLLECTION = 'contingentasset';

export function createAffidavitContingentAssetsRouter(authMw: Pick<AuthMiddlewares, 'requireAuth'>): express.Router {
  const router = express.Router({ mergeParams: true });

  router.get('/', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const rows = await listAffidavitRows(COLLECTION, userScopedFilter(targetUserObjectId));
      res.json(
        rows.map((r: any) => ({
          id: r._id?.toString?.() ?? '',
          description: r.description ?? '',
          possibleValue: Number(r.possibleValue ?? 0),
          nonMaritalTypeId: r.nonMaritalTypeId != null ? Number(r.nonMaritalTypeId) : null,
          judgeAward: Boolean(r.judgeAward ?? false)
        }))
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post('/', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const doc: any = {
        userId: new mongoose.Types.ObjectId(targetUserObjectId),
        description: parsed.data.description,
        possibleValue: parsed.data.possibleValue,
        nonMaritalTypeId: parsed.data.nonMaritalTypeId ?? null,
        judgeAward: parsed.data.judgeAward ?? false,
        createdAt: new Date()
      };
      const id = await insertAffidavitRow(COLLECTION, doc);
      res.status(201).json({ id });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.delete('/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const ok = await deleteAffidavitRow(COLLECTION, String((req.params as any).id), userScopedFilter(targetUserObjectId));
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.patch('/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const set: any = { updatedAt: new Date() };
      if (parsed.data.description != null) set.description = parsed.data.description;
      if (parsed.data.possibleValue != null) set.possibleValue = parsed.data.possibleValue;
      if (parsed.data.nonMaritalTypeId !== undefined) set.nonMaritalTypeId = parsed.data.nonMaritalTypeId ?? null;
      if (parsed.data.judgeAward !== undefined) set.judgeAward = parsed.data.judgeAward ?? false;

      const ok = await patchAffidavitRow(COLLECTION, String((req.params as any).id), userScopedFilter(targetUserObjectId), set);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  return router;
}
