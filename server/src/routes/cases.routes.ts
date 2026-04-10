import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { CaseModel, User } from '../models.js';
import { toUserSummaryDTO } from '../mappers/user.mapper.js';
import {
  canSeeCase,
  canUpdateChildSupportWorksheetFiled
} from '../lib/case-permissions.js';
import { sendError } from './error.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';

const caseCreateSchema = z.object({
  caseNumber: z.string().min(1).max(50),
  division: z.string().min(1).max(50),
  circuitId: z.number().int().min(1),
  countyId: z.number().int().min(1),
  numChildren: z.number().int().min(0).optional(),
  childSupportWorksheetFiled: z.boolean().optional(),
  formTypeId: z.number().int().optional(),
  petitionerId: z.string().optional(),
  respondentId: z.string().optional(),
  petitionerAttId: z.string().optional(),
  respondentAttId: z.string().optional(),
  legalAssistantId: z.string().optional(),
});

const caseUpdateSchema = caseCreateSchema
  .partial()
  .extend({
    childSupportWorksheetFiled: z.boolean().nullable().optional()
  });

const childSupportWorksheetFiledPatchSchema = z.object({
  childSupportWorksheetFiled: z.boolean().nullable()
});

function worksheetFiledAuditIso(c: any): string | null {
  const d = c?.childSupportWorksheetFiledUpdatedAt;
  if (d instanceof Date) return d.toISOString();
  if (typeof d === 'string') return d;
  return null;
}

function toUserSummary(u: any): { id: string; uname: string; firstName?: string; lastName?: string } {
  return toUserSummaryDTO(u);
}

async function hydrateUsersForCases(cases: any[]): Promise<{
  byObjectId: Map<string, any>;
}> {
  const objectIdStrings = new Set<string>();

  for (const c of cases) {
    for (const key of ['petitionerId', 'respondentId', 'petitionerAttId', 'respondentAttId', 'legalAssistantId'] as const) {
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

  router.get('/cases', auth.requireAuth, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;

    const queryUserIdRaw = String((req?.query?.userId ?? '') as string).trim();
    const queryUserId = queryUserIdRaw.length > 0 ? queryUserIdRaw : null;
    const queryArchived = String((req?.query?.archived ?? '') as string).toLowerCase() === 'true';
    if (queryArchived && authPayload.roleTypeId !== 5) {
      return res.status(403).json({ error: 'Only administrators can list archived cases.' });
    }

    const filter: Record<string, any> = {};
    if (authPayload.roleTypeId !== 5) {
      filter.$or = [
        { petitionerId: new mongoose.Types.ObjectId(authPayload.sub) },
        { respondentId: new mongoose.Types.ObjectId(authPayload.sub) },
        { petitionerAttId: new mongoose.Types.ObjectId(authPayload.sub) },
        { respondentAttId: new mongoose.Types.ObjectId(authPayload.sub) },
        { legalAssistantId: new mongoose.Types.ObjectId(authPayload.sub) },
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
        { respondentAttId: oid },
        { legalAssistantId: oid },
      ];
    }

    const archiveFilter = queryArchived
      ? { archivedAt: { $ne: null, $exists: true } }
      : { $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] };
    const fullFilter = Object.keys(filter).length > 0 ? { $and: [filter, archiveFilter] } : archiveFilter;

    const cases = await CaseModel.find(fullFilter).sort({ createdAt: -1, _id: -1 }).lean<any[]>();

    const { byObjectId } = await hydrateUsersForCases(cases);

    res.json(
      cases.map((c: any) => ({
        id: c._id.toString(),
        caseNumber: c.caseNumber ?? '',
        division: c.division ?? '',
        circuitId: c.circuitId,
        countyId: c.countyId,
        numChildren: c.numChildren,
        childSupportWorksheetFiled: c.childSupportWorksheetFiled,
        childSupportWorksheetFiledUpdatedAt: worksheetFiledAuditIso(c),
        childSupportWorksheetFiledUpdatedBy:
          c.childSupportWorksheetFiledUpdatedBy?._id?.toString?.() ??
          c.childSupportWorksheetFiledUpdatedBy?.toString?.() ??
          null,
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
        legalAssistant: (() => {
          const id = c.legalAssistantId?._id?.toString?.() ?? c.legalAssistantId?.toString?.();
          if (id && byObjectId.has(id)) return toUserSummary(byObjectId.get(id));
          return null;
        })(),
        createdAt: c.createdAt ?? null,
        archivedAt: c.archivedAt instanceof Date ? c.archivedAt.toISOString() : (c.archivedAt ?? null),
        archivedBy: c.archivedBy?._id?.toString?.() ?? (typeof c.archivedBy === 'string' ? c.archivedBy : null) ?? null
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
    let legalAssistantId: mongoose.Types.ObjectId | undefined;
    try {
      petitionerId = parseOptionalObjectId(parsed.data.petitionerId, 'petitionerId');
      respondentId = parseOptionalObjectId(parsed.data.respondentId, 'respondentId');
      petitionerAttId = parseOptionalObjectId(parsed.data.petitionerAttId, 'petitionerAttId');
      respondentAttId = parseOptionalObjectId(parsed.data.respondentAttId, 'respondentAttId');
      legalAssistantId = parseOptionalObjectId(parsed.data.legalAssistantId, 'legalAssistantId');
    } catch (e) {
      sendError(res, e, 400);
    }

    const worksheetAudit =
      Object.prototype.hasOwnProperty.call(parsed.data, 'childSupportWorksheetFiled') &&
      parsed.data.childSupportWorksheetFiled !== undefined
        ? {
            childSupportWorksheetFiledUpdatedAt: new Date(),
            childSupportWorksheetFiledUpdatedBy: new mongoose.Types.ObjectId(authPayload.sub)
          }
        : {};

    const created = await CaseModel.create({
      caseNumber: parsed.data.caseNumber,
      division: parsed.data.division,
      circuitId: parsed.data.circuitId,
      countyId: parsed.data.countyId,
      numChildren: parsed.data.numChildren,
      childSupportWorksheetFiled: parsed.data.childSupportWorksheetFiled,
      ...worksheetAudit,
      formTypeId: parsed.data.formTypeId,
      petitionerId,
      respondentId,
      petitionerAttId,
      respondentAttId,
      legalAssistantId,
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
      childSupportWorksheetFiled: c.childSupportWorksheetFiled,
      childSupportWorksheetFiledUpdatedAt: worksheetFiledAuditIso(c),
      childSupportWorksheetFiledUpdatedBy:
        c.childSupportWorksheetFiledUpdatedBy?._id?.toString?.() ??
        c.childSupportWorksheetFiledUpdatedBy?.toString?.() ??
        null,
      formTypeId: c.formTypeId,
      petitionerId: (c.petitionerId?._id?.toString?.() ?? c.petitionerId?.toString?.()) ?? null,
      respondentId: (c.respondentId?._id?.toString?.() ?? c.respondentId?.toString?.()) ?? null,
      petitionerAttId: (c.petitionerAttId?._id?.toString?.() ?? c.petitionerAttId?.toString?.()) ?? null,
      respondentAttId: (c.respondentAttId?._id?.toString?.() ?? c.respondentAttId?.toString?.()) ?? null,
      legalAssistantId: (c.legalAssistantId?._id?.toString?.() ?? c.legalAssistantId?.toString?.()) ?? null,
      archivedAt: c.archivedAt instanceof Date ? c.archivedAt.toISOString() : (c.archivedAt ?? null),
      archivedBy: c.archivedBy?._id?.toString?.() ?? (typeof c.archivedBy === 'string' ? c.archivedBy : null) ?? null
    });
  });

  /** Archive a case (soft delete). Staff or admin only. */
  router.post('/cases/:id/archive', auth.requireAuth, auth.requireStaffOrAdmin, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const c = await CaseModel.findById(req.params.id).select({ archivedAt: 1 }).lean();
    if (!c) return res.status(404).json({ error: 'Not found' });
    if ((c as any).archivedAt) {
      return res.status(400).json({ error: 'Case is already archived.' });
    }
    const now = new Date();
    await CaseModel.updateOne(
      { _id: req.params.id },
      { $set: { archivedAt: now, archivedBy: new mongoose.Types.ObjectId(authPayload.sub) } }
    );
    return res.json({ ok: true, archivedAt: now.toISOString() });
  });

  /** Restore an archived case. Staff or admin only. */
  router.post('/cases/:id/restore', auth.requireAuth, auth.requireStaffOrAdmin, async (req, res) => {
    const c = await CaseModel.findById(req.params.id).select({ archivedAt: 1 }).lean();
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (!(c as any).archivedAt) {
      return res.status(400).json({ error: 'Case is not archived.' });
    }
    await CaseModel.updateOne(
      { _id: req.params.id },
      { $set: { archivedAt: null, archivedBy: null } }
    );
    return res.json({ ok: true });
  });

  router.patch('/cases/:id', auth.requireAuth, auth.requireStaffOrAdmin, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const parsed = caseUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const update: any = { ...parsed.data };
    let unsetWorksheetFiled = false;
    if (
      Object.prototype.hasOwnProperty.call(update, 'childSupportWorksheetFiled') &&
      update.childSupportWorksheetFiled === null
    ) {
      unsetWorksheetFiled = true;
      delete update.childSupportWorksheetFiled;
    }
    if (Object.prototype.hasOwnProperty.call(parsed.data, 'childSupportWorksheetFiled')) {
      update.childSupportWorksheetFiledUpdatedAt = new Date();
      update.childSupportWorksheetFiledUpdatedBy = new mongoose.Types.ObjectId(authPayload.sub);
    }

    for (const key of ['petitionerId', 'respondentId', 'petitionerAttId', 'respondentAttId', 'legalAssistantId'] as const) {
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

    const mongoOp: Record<string, unknown> = { $set: update };
    if (unsetWorksheetFiled) {
      mongoOp.$unset = { childSupportWorksheetFiled: '' };
    }

    const updated = await CaseModel.findByIdAndUpdate(req.params.id, mongoOp as any, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Not found' });

    res.json({ ok: true });
  });

  /**
   * Update only whether a guidelines worksheet will be filed (petitioner, petitioner attorney,
   * legal assistant, or admin). Sets audit fields on the case.
   */
  router.patch('/cases/:id/child-support-worksheet-filed', auth.requireAuth, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const parsed = childSupportWorksheetFiledPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid case id' });
    }

    const c = await CaseModel.findById(req.params.id).lean<any>();
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (!canSeeCase(authPayload, c)) return res.status(403).json({ error: 'Forbidden' });
    if (!canUpdateChildSupportWorksheetFiled(authPayload, c)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date();
    const by = new mongoose.Types.ObjectId(authPayload.sub);
    const val = parsed.data.childSupportWorksheetFiled;

    if (val === null) {
      await CaseModel.updateOne(
        { _id: req.params.id },
        {
          $unset: { childSupportWorksheetFiled: '' },
          $set: {
            childSupportWorksheetFiledUpdatedAt: now,
            childSupportWorksheetFiledUpdatedBy: by
          }
        }
      );
    } else {
      await CaseModel.updateOne(
        { _id: req.params.id },
        {
          $set: {
            childSupportWorksheetFiled: val,
            childSupportWorksheetFiledUpdatedAt: now,
            childSupportWorksheetFiledUpdatedBy: by
          }
        }
      );
    }

    return res.json({ ok: true });
  });

  return router;
}
