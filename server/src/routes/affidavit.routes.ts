import express from 'express';
import {
  userScopedFilter,
  listAffidavitRows
} from '../lib/affidavit-store.js';
import { loadTemplatePdf, type PdfTemplateKey } from '../lib/affidavit-pdf.js';
import { computeAffidavitSummary } from '../lib/affidavit-summary.js';
import { buildAffidavitHtml, renderHtmlToPdf } from '../lib/affidavit-html-pdf.js';
import { fillOfficialAffidavitPdf } from '../lib/affidavit-official-pdf.js';
import { resolveAffidavitTarget } from './affidavit-middleware.js';
import { sendError } from './error.js';
import type { AuthMiddlewares } from './middleware.js';
import { createAffidavitEmploymentRouter } from './affidavit-employment.routes.js';
import { registerAffidavitMonthlyLinesRoutes } from './affidavit-monthly-lines.routes.js';
import { createAffidavitAssetsRouter } from './affidavit-assets.routes.js';
import { createAffidavitLiabilitiesRouter } from './affidavit-liabilities.routes.js';

export function createAffidavitRouter(authMw: Pick<AuthMiddlewares, 'requireAuth'>): express.Router {
  const router = express.Router();

  router.get('/affidavit/summary', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const summary = await computeAffidavitSummary(targetUserObjectId);
      res.json(summary);
    } catch (e) {
      sendError(res, e);
    }
  });

  router.get('/affidavit/pdf', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const requestedForm = typeof req.query.form === 'string' ? req.query.form : 'auto';
      if (!['auto', 'short', 'long'].includes(requestedForm)) {
        return res.status(400).json({ error: 'Invalid form' });
      }
      const summary = await computeAffidavitSummary(targetUserObjectId);
      const form: 'short' | 'long' = requestedForm === 'auto' ? summary.form : (requestedForm as PdfTemplateKey);
      const filter = userScopedFilter(targetUserObjectId);
      const [employment, monthlyIncome, monthlyDeductions, monthlyHouseholdExpenses, assets, liabilities] =
        await Promise.all([
          listAffidavitRows('employment', filter),
          listAffidavitRows('monthlyincome', filter),
          listAffidavitRows('monthlydeductions', filter),
          listAffidavitRows('monthlyhouseholdexpense', filter),
          listAffidavitRows('assets', filter),
          listAffidavitRows('liabilities', filter)
        ]);
      const html = buildAffidavitHtml({
        targetUserObjectId,
        form,
        summary,
        employment,
        monthlyIncome,
        monthlyDeductions,
        monthlyHouseholdExpenses,
        assets,
        liabilities
      });
      const pdfBuffer = await renderHtmlToPdf(html);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="financial-affidavit-${form}.pdf"`);
      res.send(pdfBuffer);
    } catch (e) {
      sendError(res, e);
    }
  });

  router.get('/affidavit/pdf-template/fields', authMw.requireAuth, async (req, res) => {
    try {
      const formKey = typeof req.query.form === 'string' ? req.query.form : 'short';
      if (formKey !== 'short' && formKey !== 'long') return res.status(400).json({ error: 'Invalid form' });
      const pdf = await loadTemplatePdf(formKey);
      const form = pdf.getForm();
      const fields = form.getFields().map((f: any) => ({
        type: String(f?.constructor?.name ?? 'Unknown'),
        name: String(f?.getName?.() ?? '')
      }));
      res.json({ form: formKey, fieldCount: fields.length, fields });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.get('/affidavit/pdf-template', authMw.requireAuth, async (req, res) => {
    try {
      const { auth, targetUserObjectId } = await resolveAffidavitTarget(req);
      const requestedForm = typeof req.query.form === 'string' ? req.query.form : 'auto';
      if (requestedForm !== 'auto' && requestedForm !== 'short' && requestedForm !== 'long') {
        return res.status(400).json({ error: 'Invalid form' });
      }
      const formKey: PdfTemplateKey =
        requestedForm === 'auto'
          ? (await computeAffidavitSummary(targetUserObjectId)).form
          : (requestedForm as PdfTemplateKey);
      const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
      const pdfBuffer = await fillOfficialAffidavitPdf({
        targetUserObjectId,
        formKey,
        caseId,
        auth
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="financial-affidavit-${formKey}.pdf"`);
      res.send(pdfBuffer);
    } catch (e) {
      sendError(res, e);
    }
  });

  router.use('/affidavit/employment', createAffidavitEmploymentRouter(authMw));
  registerAffidavitMonthlyLinesRoutes(router, authMw);
  router.use('/affidavit/assets', createAffidavitAssetsRouter(authMw));
  router.use('/affidavit/liabilities', createAffidavitLiabilitiesRouter(authMw));

  return router;
}
