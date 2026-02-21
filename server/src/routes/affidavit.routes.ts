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
import { loadTemplatePdf, type PdfTemplateKey } from '../lib/affidavit-pdf.js';
import { computeAffidavitSummary } from '../lib/affidavit-summary.js';
import { buildAffidavitHtml, renderHtmlToPdf } from '../lib/affidavit-html-pdf.js';
import { fillOfficialAffidavitPdf } from '../lib/affidavit-official-pdf.js';
import { resolveAffidavitTarget } from './affidavit-middleware.js';
import type { AuthMiddlewares } from './middleware.js';
import { asFiniteNumber } from '../lib/number.js';

export function createAffidavitRouter(authMw: Pick<AuthMiddlewares, 'requireAuth'>): express.Router {
  const router = express.Router();

  function sendError(res: express.Response, e: unknown): void {
    const err = e as { status?: number; message?: string };
    res.status(err?.status ?? 500).json({ error: err?.message ?? 'Failed' });
  }

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

  router.get('/affidavit/employment', authMw.requireAuth, async (req, res) => {
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
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  router.post('/affidavit/employment', authMw.requireAuth, async (req, res) => {
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
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  router.delete('/affidavit/employment/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const ok = await deleteAffidavitRow('employment', String((req.params as any).id), userScopedFilter(targetUserObjectId));
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  router.patch('/affidavit/employment/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = employmentPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const set: any = { updatedAt: new Date() };
      if (parsed.data.name != null) {
        set.name = parsed.data.name;
      }
      if (parsed.data.occupation !== undefined) {
        set.occupation = parsed.data.occupation;
      }
      if (parsed.data.payRate != null) {
        set.payRate = parsed.data.payRate;
      }
      if (parsed.data.payFrequencyTypeId != null) {
        set.payFrequencyTypeId = parsed.data.payFrequencyTypeId;
      }
      if (parsed.data.payFrequencyIfOther !== undefined) {
        set.payFrequencyIfOther = parsed.data.payFrequencyIfOther;
      }
      if (parsed.data.retired !== undefined) {
        set.retired = parsed.data.retired;
      }

      const ok = await patchAffidavitRow('employment', String((req.params as any).id), userScopedFilter(targetUserObjectId), set);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

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

  async function listMonthlyLines(
    req: express.Request,
    res: express.Response,
    collectionName: string
  ) {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const rows = await listAffidavitRows(collectionName, userScopedFilter(targetUserObjectId));
      res.json(rows.map(buildMonthlyLineListMapper()));
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  }

  async function createMonthlyLine(
    req: express.Request,
    res: express.Response,
    collectionName: string
  ) {
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
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  }

  async function deleteMonthlyLine(req: express.Request, res: express.Response, collectionName: string) {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const ok = await deleteAffidavitRow(collectionName, String((req.params as any).id), userScopedFilter(targetUserObjectId));
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  }

  async function patchMonthlyLine(
    req: express.Request,
    res: express.Response,
    collectionName: string
  ) {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = monthlyLinePatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const set: any = { updatedAt: new Date() };
      if (parsed.data.typeId != null) {
        set.typeId = parsed.data.typeId;
      }
      if (parsed.data.amount != null) {
        set.amount = parsed.data.amount;
      }
      if (parsed.data.ifOther !== undefined) {
        set.ifOther = parsed.data.ifOther ?? null;
      }

      const ok = await patchAffidavitRow(collectionName, String((req.params as any).id), userScopedFilter(targetUserObjectId), set);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  }

  router.get('/affidavit/monthly-income', authMw.requireAuth, (req, res) =>
    void listMonthlyLines(req, res, 'monthlyincome')
  );

  router.post('/affidavit/monthly-income', authMw.requireAuth, (req, res) =>
    void createMonthlyLine(req, res, 'monthlyincome')
  );

  router.delete('/affidavit/monthly-income/:id', authMw.requireAuth, (req, res) =>
    void deleteMonthlyLine(req, res, 'monthlyincome')
  );

  router.patch('/affidavit/monthly-income/:id', authMw.requireAuth, (req, res) =>
    void patchMonthlyLine(req, res, 'monthlyincome')
  );

  router.get('/affidavit/monthly-deductions', authMw.requireAuth, (req, res) =>
    void listMonthlyLines(req, res, 'monthlydeductions')
  );

  router.post('/affidavit/monthly-deductions', authMw.requireAuth, (req, res) =>
    void createMonthlyLine(req, res, 'monthlydeductions')
  );

  router.delete('/affidavit/monthly-deductions/:id', authMw.requireAuth, (req, res) =>
    void deleteMonthlyLine(req, res, 'monthlydeductions')
  );

  router.patch('/affidavit/monthly-deductions/:id', authMw.requireAuth, (req, res) =>
    void patchMonthlyLine(req, res, 'monthlydeductions')
  );

  router.get('/affidavit/monthly-household-expenses', authMw.requireAuth, (req, res) =>
    void listMonthlyLines(req, res, 'monthlyhouseholdexpense')
  );

  router.post('/affidavit/monthly-household-expenses', authMw.requireAuth, (req, res) =>
    void createMonthlyLine(req, res, 'monthlyhouseholdexpense')
  );

  router.delete('/affidavit/monthly-household-expenses/:id', authMw.requireAuth, (req, res) =>
    void deleteMonthlyLine(req, res, 'monthlyhouseholdexpense')
  );

  router.patch('/affidavit/monthly-household-expenses/:id', authMw.requireAuth, (req, res) =>
    void patchMonthlyLine(req, res, 'monthlyhouseholdexpense')
  );

  const assetsCreateSchema = z.object({
    assetsTypeId: z.number().int().min(1).max(999),
    description: z.string().min(1).max(500),
    marketValue: z.number().finite().nonnegative(),
    nonMaritalTypeId: z.number().int().min(1).max(999).optional(),
    judgeAward: z.boolean().optional()
  });

  const assetsPatchSchema = assetsCreateSchema
    .partial()
    .refine((x) => Object.keys(x).length > 0, { message: 'Invalid payload' });

  router.get('/affidavit/assets', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const rows = await listAffidavitRows('assets', userScopedFilter(targetUserObjectId));
      res.json(
        rows.map((r: any) => ({
          id: r._id?.toString?.() ?? '',
          assetsTypeId: asFiniteNumber(r.assetsTypeId) ?? null,
          description: r.description ?? '',
          marketValue: Number(r.marketValue ?? 0),
          nonMaritalTypeId: asFiniteNumber(r.nonMaritalTypeId) ?? null,
          judgeAward: Boolean(r.judgeAward ?? false)
        }))
      );
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  router.post('/affidavit/assets', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = assetsCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const doc: any = {
        userId: new mongoose.Types.ObjectId(targetUserObjectId),
        assetsTypeId: parsed.data.assetsTypeId,
        description: parsed.data.description,
        marketValue: parsed.data.marketValue,
        nonMaritalTypeId: parsed.data.nonMaritalTypeId ?? null,
        judgeAward: parsed.data.judgeAward ?? false,
        createdAt: new Date()
      };
      const id = await insertAffidavitRow('assets', doc);
      res.status(201).json({ id });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  router.delete('/affidavit/assets/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const ok = await deleteAffidavitRow('assets', String((req.params as any).id), userScopedFilter(targetUserObjectId));
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  router.patch('/affidavit/assets/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = assetsPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const set: any = { updatedAt: new Date() };
      if (parsed.data.assetsTypeId != null) {
        set.assetsTypeId = parsed.data.assetsTypeId;
      }
      if (parsed.data.description != null) {
        set.description = parsed.data.description;
      }
      if (parsed.data.marketValue != null) {
        set.marketValue = parsed.data.marketValue;
      }
      if (parsed.data.nonMaritalTypeId !== undefined) {
        set.nonMaritalTypeId = parsed.data.nonMaritalTypeId ?? null;
      }
      if (parsed.data.judgeAward !== undefined) {
        set.judgeAward = parsed.data.judgeAward ?? false;
      }

      const ok = await patchAffidavitRow('assets', String((req.params as any).id), userScopedFilter(targetUserObjectId), set);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

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

  router.get('/affidavit/liabilities', authMw.requireAuth, async (req, res) => {
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
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  router.post('/affidavit/liabilities', authMw.requireAuth, async (req, res) => {
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
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  router.delete('/affidavit/liabilities/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const ok = await deleteAffidavitRow('liabilities', String((req.params as any).id), userScopedFilter(targetUserObjectId));
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  router.patch('/affidavit/liabilities/:id', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const parsed = liabilitiesPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

      const set: any = { updatedAt: new Date() };
      if (parsed.data.liabilitiesTypeId != null) {
        set.liabilitiesTypeId = parsed.data.liabilitiesTypeId;
      }
      if (parsed.data.description != null) {
        set.description = parsed.data.description;
      }
      if (parsed.data.amountOwed != null) {
        set.amountOwed = parsed.data.amountOwed;
      }
      if (parsed.data.nonMaritalTypeId !== undefined) {
        set.nonMaritalTypeId = parsed.data.nonMaritalTypeId ?? null;
      }
      if (parsed.data.userOwes !== undefined) {
        set.userOwes = parsed.data.userOwes ?? true;
      }

      const ok = await patchAffidavitRow('liabilities', String((req.params as any).id), userScopedFilter(targetUserObjectId), set);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  return router;
}
