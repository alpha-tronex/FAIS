import express from 'express';
import mongoose from 'mongoose';
import {
  userScopedFilter,
  listAffidavitRows
} from '../lib/affidavit-store.js';
import type { LookupItem } from '../lib/affidavit-html-pdf.js';
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
import { createAffidavitContingentAssetsRouter } from './affidavit-contingent-assets.routes.js';
import { createAffidavitContingentLiabilitiesRouter } from './affidavit-contingent-liabilities.routes.js';

async function loadLookupTypes(collectionName: string): Promise<LookupItem[]> {
  const rows = await mongoose.connection
    .collection(collectionName)
    .find({})
    .project({ id: 1, name: 1 })
    .sort({ id: 1 })
    .toArray();
  return (rows as { id?: unknown; name?: string }[])
    .map((r) => ({ id: Number(r?.id), name: String(r?.name ?? '').trim() }))
    .filter((x) => Number.isFinite(x.id) && x.id > 0 && x.name);
}

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
      const { auth, targetUserObjectId } = await resolveAffidavitTarget(req);
      const requestedForm = typeof req.query.form === 'string' ? req.query.form : 'auto';
      if (!['auto', 'short', 'long'].includes(requestedForm)) {
        return res.status(400).json({ error: 'Invalid form' });
      }
      const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;

      const isAdmin = auth.roleTypeId === 5;

      if (isAdmin) {
        const formKey: PdfTemplateKey =
          requestedForm === 'auto'
            ? (await computeAffidavitSummary(targetUserObjectId)).form
            : (requestedForm as PdfTemplateKey);
        const pdfBuffer = await fillOfficialAffidavitPdf({
          targetUserObjectId,
          formKey,
          caseId,
          auth
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="financial-affidavit-${formKey}.pdf"`);
        res.send(pdfBuffer);
        return;
      }

      const summary = await computeAffidavitSummary(targetUserObjectId);
      const form: 'short' | 'long' = requestedForm === 'auto' ? summary.form : (requestedForm as PdfTemplateKey);
      const filter = userScopedFilter(targetUserObjectId);
      const [
        employment,
        monthlyIncome,
        monthlyDeductions,
        monthlyHouseholdExpenses,
        monthlyAutomobileExpenses,
        monthlyChildrenExpenses,
        monthlyChildrenOtherExpenses,
        monthlyCreditorsExpenses,
        monthlyInsuranceExpenses,
        monthlyOtherExpenses,
        assets,
        liabilities,
        contingentAssets,
        contingentLiabilities,
        payFrequencyTypes,
        incomeTypes,
        deductionTypes,
        householdExpenseTypes,
        automobileExpenseTypes,
        childrenExpenseTypes,
        childrenOtherExpenseTypes,
        creditorsExpenseTypes,
        insuranceExpenseTypes,
        otherExpenseTypes,
        assetsTypes,
        liabilitiesTypes,
        nonMaritalTypes
      ] = await Promise.all([
        listAffidavitRows('employment', filter),
        listAffidavitRows('monthlyincome', filter),
        listAffidavitRows('monthlydeductions', filter),
        listAffidavitRows('monthlyhouseholdexpense', filter),
        listAffidavitRows('monthlyautomobileexpense', filter),
        listAffidavitRows('monthlychildrenexpense', filter),
        listAffidavitRows('monthlychildrenotherrelationshipexpense', filter),
        listAffidavitRows('monthlycreditorexpense', filter),
        listAffidavitRows('monthlyinsuranceexpense', filter),
        listAffidavitRows('monthlyotherexpense', filter),
        listAffidavitRows('assets', filter),
        listAffidavitRows('liabilities', filter),
        listAffidavitRows('contingentasset', filter),
        listAffidavitRows('contingentliability', filter),
        loadLookupTypes('lookup_pay_frequency_types'),
        loadLookupTypes('lookup_monthly_income_types'),
        loadLookupTypes('lookup_monthly_deduction_types'),
        loadLookupTypes('lookup_monthly_household_expense_types'),
        loadLookupTypes('lookup_monthly_automobile_expense_types'),
        loadLookupTypes('lookup_monthly_children_expense_types'),
        loadLookupTypes('lookup_monthly_children_other_expense_types'),
        loadLookupTypes('lookup_monthly_creditors_expense_types'),
        loadLookupTypes('lookup_monthly_insurance_expense_types'),
        loadLookupTypes('lookup_monthly_other_expense_types'),
        loadLookupTypes('lookup_assets_types'),
        loadLookupTypes('lookup_liabilities_types'),
        loadLookupTypes('lookup_non_marital_types')
      ]);
      const html = buildAffidavitHtml({
        targetUserObjectId,
        form,
        summary,
        employment,
        monthlyIncome,
        monthlyDeductions,
        monthlyHouseholdExpenses,
        monthlyAutomobileExpenses,
        monthlyChildrenExpenses,
        monthlyChildrenOtherExpenses,
        monthlyCreditorsExpenses,
        monthlyInsuranceExpenses,
        monthlyOtherExpenses,
        assets,
        liabilities,
        contingentAssets,
        contingentLiabilities,
        lookups: {
          payFrequencyTypes,
          incomeTypes,
          deductionTypes,
          householdExpenseTypes,
          automobileExpenseTypes,
          childrenExpenseTypes,
          childrenOtherExpenseTypes,
          creditorsExpenseTypes,
          insuranceExpenseTypes,
          otherExpenseTypes,
          assetsTypes,
          liabilitiesTypes,
          nonMaritalTypes
        }
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
    const requestedForm = typeof req.query.form === 'string' ? req.query.form : 'auto';
    try {
      const { auth, targetUserObjectId } = await resolveAffidavitTarget(req);
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
  router.use('/affidavit/contingent-assets', createAffidavitContingentAssetsRouter(authMw));
  router.use('/affidavit/contingent-liabilities', createAffidavitContingentLiabilitiesRouter(authMw));

  return router;
}
