import express from 'express';
import { z } from 'zod';
import { loadTemplatePdf } from '../lib/affidavit-pdf.js';
import { computeAffidavitSummary } from '../lib/affidavit-summary.js';
import { getWorksheet, putWorksheet } from '../lib/child-support-worksheet-store.js';
import { fillChildSupportWorksheetPdf } from '../lib/child-support-worksheet-pdf.js';
import { resolveAffidavitTarget } from './affidavit-middleware.js';
import { sendError } from './error.js';
import type { AuthMiddlewares } from './middleware.js';
import { User } from '../models.js';

const worksheetDataSchema = z.object({
  numberOfChildren: z.number().int().min(0).max(99).optional(),
  childNames: z.array(z.string()).optional(),
  childDatesOfBirth: z.array(z.string()).optional(),
  parentAMonthlyGrossIncome: z.number().finite().nonnegative().optional(),
  parentBMonthlyGrossIncome: z.number().finite().nonnegative().optional(),
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

export function createChildSupportWorksheetRouter(authMw: Pick<AuthMiddlewares, 'requireAuth'>): express.Router {
  const router = express.Router();

  router.get('/child-support-worksheet/summary', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;

      const [targetUser, worksheetDoc, affidavitSummary] = await Promise.all([
        User.findById(targetUserObjectId).select({ firstName: 1, lastName: 1, uname: 1 }).lean(),
        getWorksheet(targetUserObjectId, caseId ?? null),
        computeAffidavitSummary(targetUserObjectId)
      ]);

      const targetUserDisplayName = targetUser
        ? (targetUser.lastName?.trim() || targetUser.firstName?.trim()
          ? [targetUser.lastName?.trim(), targetUser.firstName?.trim()].filter(Boolean).join(', ')
          : (targetUser as { uname?: string }).uname ?? '')
        : '';

      res.json({
        targetUserDisplayName,
        grossAnnualIncome: affidavitSummary.grossAnnualIncome,
        grossMonthlyIncomeFromMonthlyIncome: affidavitSummary.grossMonthlyIncomeFromMonthlyIncome,
        form: affidavitSummary.form,
        worksheet: worksheetDoc?.data ?? {}
      });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.get('/child-support-worksheet/pdf', authMw.requireAuth, async (req, res) => {
    try {
      const { auth, targetUserObjectId } = await resolveAffidavitTarget(req);
      const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;

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

      const doc = await getWorksheet(targetUserObjectId, caseId ?? null);
      res.json({ data: doc?.data ?? {} });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.put('/child-support-worksheet', authMw.requireAuth, async (req, res) => {
    try {
      const auth = (req as express.Request & { auth?: { roleTypeId: number } }).auth;
      if (auth && isRespondentViewer(auth.roleTypeId)) {
        return res.status(403).json({ error: 'Respondents cannot edit the worksheet' });
      }

      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;

      const parsed = putBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }

      await putWorksheet(targetUserObjectId, parsed.data.data, caseId ?? null);
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
