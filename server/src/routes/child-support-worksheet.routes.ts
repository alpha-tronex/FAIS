import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { loadTemplatePdf } from '../lib/affidavit-pdf.js';
import { computeAffidavitSummary } from '../lib/affidavit-summary.js';
import {
  buildWorksheetDefaultsFromCaseAndAffidavits,
  mergeStoredWorksheetWithDefaults
} from '../lib/child-support-worksheet-defaults.js';
import { getWorksheet, putWorksheet, type WorksheetData } from '../lib/child-support-worksheet-store.js';
import { fillChildSupportWorksheetPdf } from '../lib/child-support-worksheet-pdf.js';
import {
  resolveParentNetMonthlyIncomes,
  worksheetParentBNetMonthlyForGuidelines
} from '../lib/child-support-worksheet-values.js';
import { computeChildSupport } from '../lib/child-support-calculator.js';
import {
  canSeeCase,
  findCaseForWorksheetContext,
  isChildSupportWorksheetApiAllowed
} from '../lib/case-permissions.js';
import { resolveAffidavitTarget } from './affidavit-middleware.js';
import { sendError } from './error.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';
import { User } from '../models.js';

const worksheetDataSchema = z.object({
  numberOfChildren: z.number().int().min(0).max(99).optional(),
  childNames: z.array(z.string()).optional(),
  childDatesOfBirth: z.array(z.string()).optional(),
  parentAMonthlyGrossIncome: z.number().finite().nonnegative().optional(),
  parentBMonthlyGrossIncome: z.number().finite().nonnegative().optional(),
  parentBMonthlyNetIncome: z.number().finite().nonnegative().optional(),
  overnightsParentA: z.number().int().min(0).max(365).optional(),
  overnightsParentB: z.number().int().min(0).max(365).optional(),
  timesharingPercentageParentA: z.number().min(0).max(100).optional(),
  timesharingPercentageParentB: z.number().min(0).max(100).optional(),
  healthInsuranceMonthly: z.number().finite().nonnegative().optional(),
  daycareMonthly: z.number().finite().nonnegative().optional(),
  otherChildCareMonthly: z.number().finite().nonnegative().optional(),
  mandatoryUnionDues: z.number().finite().nonnegative().optional(),
  supportPaidForOtherChildren: z.number().finite().nonnegative().optional()
}).catchall(z.unknown());

const putBodySchema = z.object({ data: worksheetDataSchema });

function isRespondentViewer(roleTypeId: number): boolean {
  return roleTypeId === 2 || roleTypeId === 4;
}

const RESPONDENT_WORKSHEET_INCOME_KEYS = new Set(['parentBMonthlyGrossIncome', 'parentBMonthlyNetIncome']);

function toIdStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && '_id' in v) return String((v as { _id: unknown })._id);
  return String(v);
}

/** Respondent (2) or respondent attorney (4) on the case may PATCH worksheet respondent income only. */
function assertRespondentOrRespondentAttOnCase(auth: AuthPayload, caseDoc: any | null): void {
  if (!caseDoc) {
    throw Object.assign(new Error('Case not found'), { status: 404 });
  }
  const sub = auth.sub;
  const respondentId = toIdStr(caseDoc.respondentId);
  const respondentAttId = toIdStr(caseDoc.respondentAttId);
  if (sub !== respondentId && sub !== respondentAttId) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
}

async function assertChildSupportWorksheetAllowedForRequest(
  req: express.Request,
  targetUserObjectId: string,
  caseId: string | undefined
): Promise<void> {
  const auth = (req as express.Request & { auth?: AuthPayload }).auth as AuthPayload;
  if (caseId && !mongoose.isValidObjectId(caseId)) {
    throw Object.assign(new Error('Invalid caseId'), { status: 400 });
  }
  const caseDoc = await findCaseForWorksheetContext(targetUserObjectId, caseId);
  if (caseId && mongoose.isValidObjectId(caseId)) {
    if (!caseDoc || caseDoc._id?.toString() !== caseId) {
      throw Object.assign(new Error('Case not found'), { status: 404 });
    }
  }
  if (caseDoc && !canSeeCase(auth, caseDoc)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  if (!isChildSupportWorksheetApiAllowed(caseDoc)) {
    throw Object.assign(
      new Error(
        'Child support guidelines worksheet is not enabled for this case. Set Will a Child Support Guidelines Worksheet be filed? to Yes on the case, then try again.'
      ),
      { status: 403 }
    );
  }
}

export function createChildSupportWorksheetRouter(authMw: Pick<AuthMiddlewares, 'requireAuth'>): express.Router {
  const router = express.Router();

  router.get('/child-support-worksheet/summary', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
      await assertChildSupportWorksheetAllowedForRequest(req, targetUserObjectId, caseId);

      const [targetUser, worksheetDoc, affidavitSummary, netIncomeContext] = await Promise.all([
        User.findById(targetUserObjectId).select({ firstName: 1, lastName: 1, uname: 1 }).lean(),
        getWorksheet(targetUserObjectId, caseId ?? null),
        computeAffidavitSummary(targetUserObjectId),
        resolveParentNetMonthlyIncomes(targetUserObjectId, caseId)
      ]);

      const targetUserDisplayName = targetUser
        ? (targetUser.lastName?.trim() || targetUser.firstName?.trim()
          ? [targetUser.lastName?.trim(), targetUser.firstName?.trim()].filter(Boolean).join(', ')
          : (targetUser as { uname?: string }).uname ?? '')
        : '';

      const worksheetStored = worksheetDoc?.data ?? {};
      let worksheet = worksheetStored;
      if (caseId && typeof caseId === 'string') {
        const defaults = await buildWorksheetDefaultsFromCaseAndAffidavits(caseId);
        worksheet = mergeStoredWorksheetWithDefaults(worksheetStored, defaults);
      }
      const parentANetEffective = Number(worksheet.parentAMonthlyGrossIncome ?? netIncomeContext.parentANetMonthlyIncome);
      const parentBNetEffective = worksheetParentBNetMonthlyForGuidelines(worksheet, netIncomeContext.parentBNetMonthlyIncome);
      const calc = await computeChildSupport({
        numberOfChildren: Number(worksheet.numberOfChildren ?? 1),
        parentANetMonthlyIncome: parentANetEffective,
        parentBNetMonthlyIncome: parentBNetEffective,
        overnightsParentA: Number(worksheet.overnightsParentA ?? 0),
        overnightsParentB: Number(worksheet.overnightsParentB ?? 0),
        healthInsuranceMonthly: Number(worksheet.healthInsuranceMonthly ?? 0),
        daycareMonthly: Number(worksheet.daycareMonthly ?? 0),
        otherChildCareMonthly: Number(worksheet.otherChildCareMonthly ?? 0)
      });

      res.json({
        targetUserDisplayName,
        grossAnnualIncome: affidavitSummary.grossAnnualIncome,
        grossMonthlyIncomeFromMonthlyIncome: affidavitSummary.grossMonthlyIncomeFromMonthlyIncome,
        form: affidavitSummary.form,
        worksheet,
        netMonthlyIncome: {
          parentA: parentANetEffective,
          parentB: parentBNetEffective
        },
        calculated: calc
      });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.get('/child-support-worksheet/pdf', authMw.requireAuth, async (req, res) => {
    try {
      const { auth, targetUserObjectId } = await resolveAffidavitTarget(req);
      const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
      await assertChildSupportWorksheetAllowedForRequest(req, targetUserObjectId, caseId);
      /** Mirror affidavit official PDF policy: Admin (5), Petitioner Attorney (3), Legal Assistant (6). */
      const canGetOfficialPdf = [3, 5, 6].includes(auth.roleTypeId);
      if (!canGetOfficialPdf) {
        return res.status(403).json({
          error: 'Official child support worksheet PDF is only available to admin and petitioner-side staff. Use Print (HTML) instead.'
        });
      }

      const pdfBuffer = await fillChildSupportWorksheetPdf({
        targetUserObjectId,
        caseId,
        auth
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="child-support-guidelines-worksheet.pdf"');
      res.send(pdfBuffer);
    } catch (e) {
      sendError(res, e);
    }
  });

  router.get('/child-support-worksheet', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
      await assertChildSupportWorksheetAllowedForRequest(req, targetUserObjectId, caseId);

      const doc = await getWorksheet(targetUserObjectId, caseId ?? null);
      const stored = doc?.data ?? {};
      let data = stored;
      if (caseId && typeof caseId === 'string') {
        const defaults = await buildWorksheetDefaultsFromCaseAndAffidavits(caseId);
        data = mergeStoredWorksheetWithDefaults(stored, defaults);
      }
      res.json({ data });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.put('/child-support-worksheet', authMw.requireAuth, async (req, res) => {
    try {
      const auth = (req as express.Request & { auth?: AuthPayload }).auth as AuthPayload;
      const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;

      const parsed = putBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }

      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      await assertChildSupportWorksheetAllowedForRequest(req, targetUserObjectId, caseId);

      if (isRespondentViewer(auth.roleTypeId)) {
        if (!caseId || !mongoose.isValidObjectId(caseId)) {
          return res.status(400).json({ error: 'caseId is required to update respondent income' });
        }

        const caseDoc = await findCaseForWorksheetContext(targetUserObjectId, caseId);
        if (!caseDoc || caseDoc._id?.toString() !== caseId) {
          return res.status(404).json({ error: 'Case not found' });
        }
        assertRespondentOrRespondentAttOnCase(auth, caseDoc);

        const rawBody = req.body as { data?: Record<string, unknown> };
        const rawData = rawBody?.data && typeof rawBody.data === 'object' ? rawBody.data : null;
        if (!rawData) {
          return res.status(400).json({ error: 'Request body must include a data object' });
        }
        const rawKeys = Object.keys(rawData);
        const unknownKeys = rawKeys.filter((k) => !RESPONDENT_WORKSHEET_INCOME_KEYS.has(k));
        if (unknownKeys.length > 0) {
          return res.status(400).json({
            error: 'Only respondent gross and net monthly income may be updated from this role',
            details: unknownKeys
          });
        }

        if (
          rawData.parentBMonthlyGrossIncome === undefined &&
          rawData.parentBMonthlyNetIncome === undefined
        ) {
          return res.status(400).json({
            error: 'Provide parentBMonthlyGrossIncome and/or parentBMonthlyNetIncome'
          });
        }

        const incoming = parsed.data.data as Record<string, unknown>;
        const existingDoc = await getWorksheet(targetUserObjectId, caseId);
        const merged: WorksheetData = { ...(existingDoc?.data ?? {}) };
        if (incoming.parentBMonthlyGrossIncome !== undefined) {
          merged.parentBMonthlyGrossIncome = parsed.data.data.parentBMonthlyGrossIncome;
        }
        if (incoming.parentBMonthlyNetIncome !== undefined) {
          merged.parentBMonthlyNetIncome = parsed.data.data.parentBMonthlyNetIncome;
        }

        await putWorksheet(targetUserObjectId, merged, caseId, { updatedBy: auth.sub });
        res.json({ ok: true });
        return;
      }

      await putWorksheet(targetUserObjectId, parsed.data.data, caseId ?? null, { updatedBy: auth.sub });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.get('/child-support-worksheet/pdf-template/fields', authMw.requireAuth, async (_req, res) => {
    try {
      const pdf = await loadTemplatePdf('child-support-worksheet');
      const form = pdf.getForm();
      const fields = form.getFields().map((f: any) => ({
        type: String(f?.constructor?.name ?? 'Unknown'),
        name: String(f?.getName?.() ?? '')
      }));
      res.json({ form: 'child-support-worksheet', fieldCount: fields.length, fields });
    } catch (e) {
      sendError(res, e);
    }
  });

  return router;
}
