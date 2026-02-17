import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { User } from '../models.js';
import { asFiniteNumber } from '../lib/number.js';
import {
  userScopedFilter,
  listAffidavitRows,
  insertAffidavitRow,
  deleteAffidavitRow,
  patchAffidavitRow,
  sumMonthlyIncomeForUser,
  listEmploymentRowsForUser
} from '../lib/affidavit-store.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';

export function createAffidavitRouter(authMw: Pick<AuthMiddlewares, 'requireAuth'>): express.Router {
  const router = express.Router();

  const PDF_TEMPLATES_DIR = path.join(process.cwd(), 'private', 'forms');

  type PdfTemplateKey = 'short' | 'long';

  function templatePath(key: PdfTemplateKey): string {
    const filename = key === 'short' ? 'fl-financial-affidavit-short.pdf' : 'fl-financial-affidavit-long.pdf';
    return path.join(PDF_TEMPLATES_DIR, filename);
  }

  async function loadTemplatePdf(key: PdfTemplateKey): Promise<PDFDocument> {
    const p = templatePath(key);
    const bytes = await fs.readFile(p);
    return await PDFDocument.load(bytes);
  }

  function stripLeadingInstructionPages(pdf: PDFDocument, count: number) {
    const total = pdf.getPageCount();
    const toRemove = Math.min(Math.max(count, 0), total);
    // Remove from the front; indices shift, so remove repeatedly at index 0.
    for (let i = 0; i < toRemove; i += 1) {
      pdf.removePage(0);
    }
  }

  function userFullName(user: any): string {
    const first = String(user?.firstName ?? '').trim();
    const last = String(user?.lastName ?? '').trim();
    const full = `${first} ${last}`.trim();
    return full || String(user?.uname ?? '').trim();
  }

  function setTextIfExists(form: any, fieldName: string, value: string) {
    try {
      const f = form.getTextField(fieldName);
      f.setText(value);
    } catch {
      // Ignore missing fields; templates vary by revision.
    }
  }

  function checkIfExists(form: any, fieldName: string, checked: boolean) {
    try {
      const f = form.getCheckBox(fieldName);
      if (checked) f.check();
      else f.uncheck();
    } catch {
      // Ignore missing fields
    }
  }

  function payFrequencyToAnnualMultiplier(payFrequencyTypeId: number | null): number | null {
    switch (payFrequencyTypeId) {
      case 1:
        return 52; // Weekly
      case 2:
        return 26; // Bi-Weekly
      case 3:
        return 12; // Monthly
      case 4:
        return 24; // Bi-Monthly (twice/month)
      case 5:
        return 1; // Annually
      case 6:
        return 2; // Semi-Annually
      case 7:
        return 4; // Quarterly
      case 8:
        return 260; // Daily (assume 5 days/week)
      case 9:
        return 2080; // Hourly (assume 40 hrs/week)
      default:
        return null; // Other / unknown
    }
  }

  async function computeAffidavitSummary(userObjectId: string): Promise<{
    grossAnnualIncome: number;
    grossAnnualIncomeFromEmployment: number;
    grossMonthlyIncomeFromMonthlyIncome: number;
    grossAnnualIncomeFromMonthlyIncome: number;
    threshold: number;
    form: 'short' | 'long';
  }> {
    // Threshold basis: derive gross annual from Employment pay rate/frequency.
    const employmentRows = await listEmploymentRowsForUser(userObjectId);
    const employmentAnnual = employmentRows.reduce((sum: number, row: any) => {
      const payRate = Number(row?.payRate);
      const freqId = asFiniteNumber(row?.payFrequencyTypeId);
      if (!Number.isFinite(payRate) || payRate <= 0) return sum;
      const mult = payFrequencyToAnnualMultiplier(freqId);
      if (mult == null) return sum;
      return sum + payRate * mult;
    }, 0);

    // Also compute MonthlyIncome totals (useful for display/diagnostics and as a fallback).
    const grossMonthlyIncome = await sumMonthlyIncomeForUser(userObjectId);
    const grossAnnualIncomeFromMonthlyIncome = grossMonthlyIncome * 12;

    const grossAnnualIncome = employmentAnnual;
    const threshold = 50000;
    const form: 'short' | 'long' = grossAnnualIncome < threshold ? 'short' : 'long';

    return {
      grossAnnualIncome,
      grossAnnualIncomeFromEmployment: employmentAnnual,
      grossMonthlyIncomeFromMonthlyIncome: grossMonthlyIncome,
      grossAnnualIncomeFromMonthlyIncome,
      threshold,
      form
    };
  }

  function escapeHtml(input: unknown): string {
    const s = String(input ?? '');
    return s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatMoney(n: unknown): string {
    const x = Number(n);
    if (!Number.isFinite(x)) return '';
    return x.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  async function resolveAffidavitTarget(req: express.Request): Promise<{
    auth: AuthPayload;
    targetUserObjectId: string;
  }> {
    const auth = (req as any).auth as AuthPayload;
    const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;

    if (requestedUserId) {
      if (auth.roleTypeId !== 5) {
        throw Object.assign(new Error('Forbidden'), { status: 403 });
      }
      if (!mongoose.isValidObjectId(requestedUserId)) {
        throw Object.assign(new Error('Invalid userId'), { status: 400 });
      }
      const target = await User.findById(requestedUserId).lean<any>();
      if (!target) {
        throw Object.assign(new Error('Not found'), { status: 404 });
      }
      return { auth, targetUserObjectId: requestedUserId };
    }

    return { auth, targetUserObjectId: auth.sub };
  }

  // Financial affidavit summary: choose short vs long based on gross annual income.
  router.get('/affidavit/summary', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);
      const summary = await computeAffidavitSummary(targetUserObjectId);
      res.json(summary);
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
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
      const form: 'short' | 'long' = requestedForm === 'auto' ? summary.form : (requestedForm as any);

      const filter = userScopedFilter(targetUserObjectId);
      const [employment, monthlyIncome, monthlyDeductions, monthlyHouseholdExpenses, assets, liabilities] = await Promise.all([
        listAffidavitRows('employment', filter),
        listAffidavitRows('monthlyincome', filter),
        listAffidavitRows('monthlydeductions', filter),
        listAffidavitRows('monthlyhouseholdexpense', filter),
        listAffidavitRows('assets', filter),
        listAffidavitRows('liabilities', filter)
      ]);

      const title = `Financial Affidavit (${form === 'short' ? 'Short' : 'Long'})`;

      const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: letter; margin: 0.6in; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 6px 0; }
      h2 { font-size: 14px; margin: 18px 0 6px 0; }
      .muted { color: #555; }
      .row { display: flex; gap: 24px; flex-wrap: wrap; }
      .k { font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
      th { background: #f6f6f6; text-align: left; }
      .right { text-align: right; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <div class="row muted">
      <div><span class="k">Generated:</span> ${escapeHtml(new Date().toLocaleString())}</div>
      <div><span class="k">User ID:</span> ${escapeHtml(targetUserObjectId)}</div>
    </div>

    <h2>Income Summary</h2>
    <div class="row">
      <div><span class="k">Gross annual income (employment-derived):</span> ${escapeHtml(formatMoney(summary.grossAnnualIncomeFromEmployment))}</div>
      <div><span class="k">Threshold:</span> ${escapeHtml(formatMoney(summary.threshold))}</div>
    </div>

    <h2>Employment</h2>
    <table>
      <thead>
        <tr>
          <th>Employer</th>
          <th>Pay rate</th>
          <th>Frequency type ID</th>
        </tr>
      </thead>
      <tbody>
        ${(employment.length ? employment : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(r.name ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.payRate))}</td>
            <td>${escapeHtml(asFiniteNumber(r.payFrequencyTypeId) ?? '')}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>

    <h2>Monthly Income</h2>
    <table>
      <thead>
        <tr>
          <th>Type ID</th>
          <th>Description</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${(monthlyIncome.length ? monthlyIncome : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(asFiniteNumber(r.typeId) ?? '')}</td>
            <td>${escapeHtml(r.ifOther ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.amount))}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>

    <h2>Monthly Deductions</h2>
    <table>
      <thead>
        <tr>
          <th>Type ID</th>
          <th>Description</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${(monthlyDeductions.length ? monthlyDeductions : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(asFiniteNumber(r.typeId) ?? '')}</td>
            <td>${escapeHtml(r.ifOther ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.amount))}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>

    <h2>Monthly Household Expenses</h2>
    <table>
      <thead>
        <tr>
          <th>Type ID</th>
          <th>Description</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${(monthlyHouseholdExpenses.length ? monthlyHouseholdExpenses : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(asFiniteNumber(r.typeId) ?? '')}</td>
            <td>${escapeHtml(r.ifOther ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.amount))}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>

    <h2>Assets</h2>
    <table>
      <thead>
        <tr>
          <th>Type ID</th>
          <th>Description</th>
          <th class="right">Market value</th>
          <th>Non-marital type ID</th>
        </tr>
      </thead>
      <tbody>
        ${(assets.length ? assets : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(asFiniteNumber(r.assetsTypeId) ?? '')}</td>
            <td>${escapeHtml(r.description ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.marketValue))}</td>
            <td>${escapeHtml(asFiniteNumber(r.nonMaritalTypeId) ?? '')}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>

    <h2>Liabilities</h2>
    <table>
      <thead>
        <tr>
          <th>Type ID</th>
          <th>Description</th>
          <th class="right">Amount owed</th>
          <th>Non-marital type ID</th>
        </tr>
      </thead>
      <tbody>
        ${(liabilities.length ? liabilities : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(asFiniteNumber(r.liabilitiesTypeId) ?? '')}</td>
            <td>${escapeHtml(r.description ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.amountOwed))}</td>
            <td>${escapeHtml(asFiniteNumber(r.nonMaritalTypeId) ?? '')}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>

    <p class="muted" style="margin-top: 18px;">
      This PDF is generated from data entered in FAIS. It is a draft summary and not an official court form.
    </p>
  </body>
</html>`;

      const { chromium } = await import('playwright');
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle' });
        const pdf = await page.pdf({ format: 'Letter', printBackground: true });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="financial-affidavit-${form}.pdf"`);
        res.send(pdf);
      } finally {
        await browser.close();
      }
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  // Inspect AcroForm fields for the official PDF templates.
  router.get('/affidavit/pdf-template/fields', authMw.requireAuth, async (req, res) => {
    try {
      const formKey = typeof req.query.form === 'string' ? req.query.form : 'short';
      if (formKey !== 'short' && formKey !== 'long') return res.status(400).json({ error: 'Invalid form' });

      // Admins can inspect on behalf, but the template itself is not user-specific.
      const pdf = await loadTemplatePdf(formKey);
      const form = pdf.getForm();
      const fields = form.getFields().map((f: any) => ({
        type: String(f?.constructor?.name ?? 'Unknown'),
        name: String(f?.getName?.() ?? '')
      }));

      res.json({ form: formKey, fieldCount: fields.length, fields });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
    }
  });

  // Fill the official PDF template (AcroForm) using the app's collected data.
  // NOTE: Field mapping is iterative. Start by calling /affidavit/pdf-template/fields
  // and then expand the mappings below.
  router.get('/affidavit/pdf-template', authMw.requireAuth, async (req, res) => {
    try {
      const { targetUserObjectId } = await resolveAffidavitTarget(req);

      const formKey = typeof req.query.form === 'string' ? req.query.form : 'short';
      if (formKey !== 'short' && formKey !== 'long') return res.status(400).json({ error: 'Invalid form' });

      const user = await User.findById(targetUserObjectId).lean<any>();
      if (!user) return res.status(404).json({ error: 'User not found' });

      const pdf = await loadTemplatePdf(formKey);
      // The official templates include instruction pages before the fillable form.
      // Do not include those pages in the generated output.
      stripLeadingInstructionPages(pdf, 3);
      const form = pdf.getForm();

      // Collect affidavit data already stored in Mongo.
      const filter = userScopedFilter(targetUserObjectId);
      const [employment] = await Promise.all([listAffidavitRows('employment', filter)]);

      const name = userFullName(user);
      const primaryEmployment = employment?.[0] ?? null;
      const employer = String(primaryEmployment?.name ?? '').trim();
      const payRate = primaryEmployment?.payRate;
      const payFrequencyTypeId = asFiniteNumber(primaryEmployment?.payFrequencyTypeId);

      // ---- Minimal mapping (expand as we map more fields) ----
      if (formKey === 'short') {
        // The PDF currently in server/private/forms appears to be a short-form disclosure-related PDF.
        // We still fill what we safely can (name, signature date, etc.).
        setTextIfExists(form, 'full legal name 1', name);
        setTextIfExists(form, 'date of signature', new Date().toLocaleDateString());
      }

      if (formKey === 'long') {
        // Long form financial affidavit (12.902(c) style) contains income section fields.
        setTextIfExists(form, 'I full legal name', name);
        if (employer) setTextIfExists(form, 'Employed by', employer);
        if (payRate != null && Number.isFinite(Number(payRate))) {
          setTextIfExists(form, 'Pay rate', String(payRate));
        }

        // Some templates have frequency checkboxes; we only check if we find the exact names.
        // (We’ll refine these once we confirm the checkbox field names in your specific PDF.)
        if (payFrequencyTypeId != null) {
          checkIfExists(form, 'Hourly', payFrequencyTypeId === 9);
          checkIfExists(form, 'Weekly', payFrequencyTypeId === 1);
          checkIfExists(form, 'Biweekly', payFrequencyTypeId === 2);
          checkIfExists(form, 'Monthly', payFrequencyTypeId === 3);
        }
      }

      // Flatten so values become “affixed” and harder to accidentally edit.
      try {
        form.flatten();
      } catch {
        // Some PDFs may not support flattening cleanly; still return filled.
      }

      const bytes = await pdf.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="financial-affidavit-${formKey}-template.pdf"`);
      res.send(Buffer.from(bytes));
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Failed' });
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
