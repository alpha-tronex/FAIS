import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { CaseModel, User } from '../models.js';
import { toUserSummaryDTO } from '../mappers/user.mapper.js';
import { sendError } from './error.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';

const caseCreateSchema = z.object({
  caseNumber: z.string().min(1).max(50),
  division: z.string().min(1).max(50),
  circuitId: z.number().int().min(1),
  countyId: z.number().int().min(1),
  numChildren: z.number().int().optional(),
  formTypeId: z.number().int().optional(),
  petitionerId: z.string().optional(),
  respondentId: z.string().optional(),
  petitionerAttId: z.string().optional(),
  respondentAttId: z.string().optional()
});

const caseUpdateSchema = caseCreateSchema.partial();

function canSeeCase(auth: AuthPayload, c: any): boolean {
  if (auth.roleTypeId === 5) return true;

  const userId = auth.sub;
  const petitionerObjId = c.petitionerId?._id?.toString?.() ?? c.petitionerId?.toString?.();
  const respondentObjId = c.respondentId?._id?.toString?.() ?? c.respondentId?.toString?.();
  const petitionerAttObjId = c.petitionerAttId?._id?.toString?.() ?? c.petitionerAttId?.toString?.();
  const respondentAttObjId = c.respondentAttId?._id?.toString?.() ?? c.respondentAttId?.toString?.();

  const isPetitionerByObjId = petitionerObjId === userId;
  const isRespondentByObjId = respondentObjId === userId;
  const isPetitionerAttorneyByObjId = petitionerAttObjId === userId;
  const isRespondentAttorneyByObjId = respondentAttObjId === userId;

  return (
    isPetitionerByObjId ||
    isRespondentByObjId ||
    isPetitionerAttorneyByObjId ||
    isRespondentAttorneyByObjId
  );
}

function toUserSummary(u: any): { id: string; uname: string; firstName?: string; lastName?: string } {
  return toUserSummaryDTO(u);
}

async function hydrateUsersForCases(cases: any[]): Promise<{
  byObjectId: Map<string, any>;
}> {
  const objectIdStrings = new Set<string>();

  for (const c of cases) {
    for (const key of ['petitionerId', 'respondentId', 'petitionerAttId', 'respondentAttId'] as const) {
      const v = c?.[key];
      const id = v?._id?.toString?.() ?? v?.toString?.();
      if (id && mongoose.isValidObjectId(id)) objectIdStrings.add(id);
    }

  }

  const byObjectId = new Map<string, any>();

  if (objectIdStrings.size > 0) {
    const objectIds = Array.from(objectIdStrings).map((s) => new mongoose.Types.ObjectId(s));
    const docs = await User.find({ _id: { $in: objectIds } })
      .select({ uname: 1, firstName: 1, lastName: 1, email: 1, roleTypeId: 1 })
      .lean<any[]>();
    for (const d of docs) byObjectId.set(d._id.toString(), d);
  }

  return { byObjectId };
}

function parseOptionalObjectId(value: string | undefined, fieldName: string): mongoose.Types.ObjectId | undefined {
  if (value == null || value === '') return undefined;
  if (!mongoose.isValidObjectId(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return new mongoose.Types.ObjectId(value);
}

export function createCasesRouter(
  auth: Pick<AuthMiddlewares, 'requireAuth' | 'requireStaffOrAdmin'>
): express.Router {
  const router = express.Router();

  router.get('/cases', auth.requireAuth, async (_req, res) => {
    const authPayload = (_req as any).auth as AuthPayload;

    const queryUserIdRaw = String(((_req as any)?.query?.userId ?? '') as any).trim();
    const queryUserId = queryUserIdRaw.length > 0 ? queryUserIdRaw : null;

    const filter: Record<string, any> = {};
    if (authPayload.roleTypeId !== 5) {
      filter.$or = [
        { petitionerId: new mongoose.Types.ObjectId(authPayload.sub) },
        { respondentId: new mongoose.Types.ObjectId(authPayload.sub) },
        { petitionerAttId: new mongoose.Types.ObjectId(authPayload.sub) },
        { respondentAttId: new mongoose.Types.ObjectId(authPayload.sub) }
      ];
    } else if (queryUserId) {
      if (!mongoose.isValidObjectId(queryUserId)) {
        return res.status(400).json({ error: 'Invalid userId' });
      }
      const oid = new mongoose.Types.ObjectId(queryUserId);
      filter.$or = [
        { petitionerId: oid },
        { respondentId: oid },
        { petitionerAttId: oid },
        { respondentAttId: oid }
      ];
    }

    const cases = await CaseModel.find(filter).sort({ createdAt: -1, _id: -1 }).lean<any[]>();

    const { byObjectId } = await hydrateUsersForCases(cases);

    res.json(
      cases.map((c: any) => ({
        id: c._id.toString(),
        caseNumber: c.caseNumber ?? '',
        division: c.division ?? '',
        circuitId: c.circuitId,
        countyId: c.countyId,
        numChildren: c.numChildren,
        formTypeId: c.formTypeId,
        petitioner: (() => {
          const id = c.petitionerId?._id?.toString?.() ?? c.petitionerId?.toString?.();
          if (id && byObjectId.has(id)) return toUserSummary(byObjectId.get(id));
          return null;
        })(),
        respondent: (() => {
          const id = c.respondentId?._id?.toString?.() ?? c.respondentId?.toString?.();
          if (id && byObjectId.has(id)) return toUserSummary(byObjectId.get(id));
          return null;
        })(),
        petitionerAttorney: (() => {
          const id = c.petitionerAttId?._id?.toString?.() ?? c.petitionerAttId?.toString?.();
          if (id && byObjectId.has(id)) return toUserSummary(byObjectId.get(id));
          return null;
        })(),
        respondentAttorney: (() => {
          const id = c.respondentAttId?._id?.toString?.() ?? c.respondentAttId?.toString?.();
          if (id && byObjectId.has(id)) return toUserSummary(byObjectId.get(id));
          return null;
        })(),
        createdAt: c.createdAt ?? null
      }))
    );
  });

  router.post('/cases', auth.requireAuth, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    if (authPayload.roleTypeId !== 5) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const parsed = caseCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

    async function getCountyCircuitId(countyId: number): Promise<number | null> {
      const row = await mongoose
        .connection
        .collection('lookup_counties')
        .findOne({ id: countyId }, { projection: { circuitId: 1 } });

      const circuitId = Number((row as any)?.circuitId);
      return Number.isFinite(circuitId) ? circuitId : null;
    }

    const countyCircuitId = await getCountyCircuitId(parsed.data.countyId);
    if (countyCircuitId == null) {
      return res.status(400).json({ error: 'Invalid countyId' });
    }
    if (countyCircuitId !== parsed.data.circuitId) {
      return res.status(400).json({ error: 'countyId does not belong to circuitId' });
    }

    let petitionerId: mongoose.Types.ObjectId | undefined;
    let respondentId: mongoose.Types.ObjectId | undefined;
    let petitionerAttId: mongoose.Types.ObjectId | undefined;
    let respondentAttId: mongoose.Types.ObjectId | undefined;
    try {
      petitionerId = parseOptionalObjectId(parsed.data.petitionerId, 'petitionerId');
      respondentId = parseOptionalObjectId(parsed.data.respondentId, 'respondentId');
      petitionerAttId = parseOptionalObjectId(parsed.data.petitionerAttId, 'petitionerAttId');
      respondentAttId = parseOptionalObjectId(parsed.data.respondentAttId, 'respondentAttId');
    } catch (e) {
      sendError(res, e, 400);
    }

    const created = await CaseModel.create({
      caseNumber: parsed.data.caseNumber,
      division: parsed.data.division,
      circuitId: parsed.data.circuitId,
      countyId: parsed.data.countyId,
      numChildren: parsed.data.numChildren,
      formTypeId: parsed.data.formTypeId,
      petitionerId,
      respondentId,
      petitionerAttId,
      respondentAttId,
      createdByUserId: new mongoose.Types.ObjectId(authPayload.sub)
    });

    res.status(201).json({ id: created._id.toString() });
  });

  router.get('/cases/:id', auth.requireAuth, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const c = await CaseModel.findById(req.params.id).lean<any>();
    if (!c) return res.status(404).json({ error: 'Not found' });

    if (!canSeeCase(authPayload, c)) return res.status(403).json({ error: 'Forbidden' });

    res.json({
      id: c._id.toString(),
      caseNumber: c.caseNumber ?? '',
      division: c.division ?? '',
      circuitId: c.circuitId,
      countyId: c.countyId,
      numChildren: c.numChildren,
      formTypeId: c.formTypeId,
      petitionerId: (c.petitionerId?._id?.toString?.() ?? c.petitionerId?.toString?.()) ?? null,
      respondentId: (c.respondentId?._id?.toString?.() ?? c.respondentId?.toString?.()) ?? null,
      petitionerAttId: (c.petitionerAttId?._id?.toString?.() ?? c.petitionerAttId?.toString?.()) ?? null,
      respondentAttId: (c.respondentAttId?._id?.toString?.() ?? c.respondentAttId?.toString?.()) ?? null
    });
  });

  router.patch('/cases/:id', auth.requireAuth, auth.requireStaffOrAdmin, async (req, res) => {
    const parsed = caseUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const update: any = { ...parsed.data };
    for (const key of ['petitionerId', 'respondentId', 'petitionerAttId', 'respondentAttId'] as const) {
      if (key in update) {
        if (update[key] == null || update[key] === '') {
          update[key] = undefined;
          continue;
        }
        if (!mongoose.isValidObjectId(update[key])) {
          return res.status(400).json({ error: `Invalid ${key}` });
        }
        update[key] = new mongoose.Types.ObjectId(update[key]);
      }
    }

    const updated = await CaseModel.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Not found' });

    res.json({ ok: true });
  });

  return router;
}
