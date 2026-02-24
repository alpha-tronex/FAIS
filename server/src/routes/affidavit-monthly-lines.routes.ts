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

const monthlyLineCreateSchema = z.object({
  typeId: z.number().int().min(1).max(999),
  amount: z.number().finite().nonnegative(),
  ifOther: z.string().optional()
});

const monthlyLinePatchSchema = monthlyLineCreateSchema
  .partial()
  .refine((x) => Object.keys(x).length > 0, { message: 'Invalid payload' });

function buildMonthlyLineListMapper() {
  return (r: any) => ({
    id: r._id?.toString?.() ?? '',
    typeId: asFiniteNumber(r?.typeId) ?? null,
    amount: Number(r?.amount ?? 0),
    ifOther: r?.ifOther ?? null
  });
}

const COLLECTIONS = [
  { path: 'monthly-income', collectionName: 'monthlyincome' },
  { path: 'monthly-deductions', collectionName: 'monthlydeductions' },
  { path: 'monthly-household-expenses', collectionName: 'monthlyhouseholdexpense' },
  { path: 'monthly-automobile-expenses', collectionName: 'monthlyautomobileexpense' },
  { path: 'monthly-children-expenses', collectionName: 'monthlychildrenexpense' },
  { path: 'monthly-children-other-expenses', collectionName: 'monthlychildrenotherrelationshipexpense' },
  { path: 'monthly-creditors-expenses', collectionName: 'monthlycreditorexpense' },
  { path: 'monthly-insurance-expenses', collectionName: 'monthlyinsuranceexpense' },
  { path: 'monthly-other-expenses', collectionName: 'monthlyotherexpense' }
] as const;

export function registerAffidavitMonthlyLinesRoutes(
  router: express.Router,
  authMw: Pick<AuthMiddlewares, 'requireAuth'>
): void {
  async function listMonthlyLines(req: express.Request, res: express.Response, collectionName: string) {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const rows = await listAffidavitRows(collectionName, userScopedFilter(targetUserObjectId));
      res.json(rows.map(buildMonthlyLineListMapper()));
    } catch (e) {
      sendError(res, e);
    }
  }

  async function createMonthlyLine(req: express.Request, res: express.Response, collectionName: string) {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = monthlyLineCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const doc: any = {
        userId: new mongoose.Types.ObjectId(targetUserObjectId),
        typeId: parsed.data.typeId,
        amount: parsed.data.amount,
        ifOther: parsed.data.ifOther ?? null,
        createdAt: new Date()
      };

      const id = await insertAffidavitRow(collectionName, doc);
      res.status(201).json({ id });
    } catch (e) {
      sendError(res, e);
    }
  }

  async function deleteMonthlyLine(req: express.Request, res: express.Response, collectionName: string) {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const ok = await deleteAffidavitRow(collectionName, String((req.params as any).id), userScopedFilter(targetUserObjectId));
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  }

  async function patchMonthlyLine(req: express.Request, res: express.Response, collectionName: string) {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = monthlyLinePatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const set: any = { updatedAt: new Date() };
      if (parsed.data.typeId != null) set.typeId = parsed.data.typeId;
      if (parsed.data.amount != null) set.amount = parsed.data.amount;
      if (parsed.data.ifOther !== undefined) set.ifOther = parsed.data.ifOther ?? null;

      const ok = await patchAffidavitRow(collectionName, String((req.params as any).id), userScopedFilter(targetUserObjectId), set);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  }

  for (const { path, collectionName } of COLLECTIONS) {
    const base = `/affidavit/${path}`;
    router.get(base, authMw.requireAuth, (req, res) => void listMonthlyLines(req, res, collectionName));
    router.post(base, authMw.requireAuth, (req, res) => void createMonthlyLine(req, res, collectionName));
    router.delete(`${base}/:id`, authMw.requireAuth, (req, res) => void deleteMonthlyLine(req, res, collectionName));
    router.patch(`${base}/:id`, authMw.requireAuth, (req, res) => void patchMonthlyLine(req, res, collectionName));
  }
}
