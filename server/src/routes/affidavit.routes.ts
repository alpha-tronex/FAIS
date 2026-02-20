import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { CaseModel, User } from '../models.js';
import { asFiniteNumber } from '../lib/number.js';
import {
  userScopedFilter,
  listAffidavitRows,
  insertAffidavitRow,
  deleteAffidavitRow,
  patchAffidavitRow,
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
    try {
      const bytes = await fs.readFile(p);
      return await PDFDocument.load(bytes);
    } catch (e: any) {
      const err = new Error(
        `Missing PDF template file: ${p}. Place the official form PDFs under server/private/forms/.`
      );
      (err as any).status = 500;
      throw err;
    }
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

  function userDisplayName(user: any): string {
    // For case captions, prefer "First Last" (or uname if missing).
    return userFullName(user);
  }

  function caseIncludesUser(caseDoc: any, userObjectId: string): boolean {
    const target = String(userObjectId);
    const ids = [caseDoc?.petitionerId, caseDoc?.respondentId, caseDoc?.petitionerAttId, caseDoc?.respondentAttId]
      .map((v: any) => v?._id?.toString?.() ?? v?.toString?.())
      .filter(Boolean);
    return ids.some((id: string) => id === target);
  }

  async function lookupName(collectionName: string, id: number | null | undefined): Promise<string> {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) return '';
    const row = await mongoose
      .connection
      .collection(collectionName)
      .findOne({ id: n }, { projection: { name: 1 } });
    return String((row as any)?.name ?? '').trim();
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
    monthlyIncomeBreakdown: { typeId: number | null; typeName: string; amount: number; ifOther: string | null }[];
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

    // Monthly income: total and per-row breakdown for display.
    const monthlyIncomeRows = await listAffidavitRows('monthlyincome', userScopedFilter(userObjectId));
    const grossMonthlyIncome = monthlyIncomeRows.reduce((sum: number, r: any) => sum + Number(r?.amount ?? 0), 0);
    const grossAnnualIncomeFromMonthlyIncome = grossMonthlyIncome * 12;

    const incomeTypeRows = await mongoose.connection
      .collection('lookup_monthly_income_types')
      .find({})
      .project({ id: 1, name: 1 })
      .toArray();
    const typeNameById = new Map<number, string>();
    for (const row of incomeTypeRows as any[]) {
      const id = asFiniteNumber(row?.id);
      if (id != null && id > 0) typeNameById.set(id, String(row?.name ?? '').trim());
    }
    const monthlyIncomeBreakdown = monthlyIncomeRows.map((r: any) => {
      const typeId = asFiniteNumber(r?.typeId) ?? null;
      return {
        typeId,
        typeName: (typeId != null ? typeNameById.get(typeId) : null) ?? `Type ${typeId ?? '?'}`,
        amount: Number(r?.amount ?? 0),
        ifOther: r?.ifOther ?? null
      };
    });

    const grossAnnualIncome = employmentAnnual;
    const threshold = 50000;
    const form: 'short' | 'long' = grossAnnualIncome < threshold ? 'short' : 'long';

    return {
      grossAnnualIncome,
      grossAnnualIncomeFromEmployment: employmentAnnual,
      grossMonthlyIncomeFromMonthlyIncome: grossMonthlyIncome,
      grossAnnualIncomeFromMonthlyIncome,
      threshold,
      form,
      monthlyIncomeBreakdown
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
      const { auth, targetUserObjectId } = await resolveAffidavitTarget(req);

      const requestedForm = typeof req.query.form === 'string' ? req.query.form : 'auto';
      if (requestedForm !== 'auto' && requestedForm !== 'short' && requestedForm !== 'long') {
        return res.status(400).json({ error: 'Invalid form' });
      }

      const formKey: PdfTemplateKey =
        requestedForm === 'auto'
          ? (await computeAffidavitSummary(targetUserObjectId)).form
          : (requestedForm as PdfTemplateKey);

      const user = await User.findById(targetUserObjectId).lean<any>();
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Attempt to populate case caption fields (circuit/county/case#/division/petitioner/respondent).
      // If a specific caseId is provided, use it (only if it includes the target user).
      // Otherwise, use the most recently created case that includes the target user.
      const requestedCaseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
      let caseDoc: any | null = null;

      if (requestedCaseId) {
        if (!mongoose.isValidObjectId(requestedCaseId)) {
          return res.status(400).json({ error: 'Invalid caseId' });
        }
        caseDoc = await CaseModel.findById(requestedCaseId)
          .populate('petitionerId', 'uname firstName lastName')
          .populate('respondentId', 'uname firstName lastName')
          .lean<any>();
        if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
        if (!caseIncludesUser(caseDoc, targetUserObjectId)) {
          return res.status(400).json({ error: 'caseId does not belong to target user' });
        }
        // For non-admin users, also ensure they are allowed to access this case.
        if (auth.roleTypeId !== 5 && !caseIncludesUser(caseDoc, auth.sub)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      } else {
        const participantFilter: Record<string, any> = {
          $or: [
            { petitionerId: new mongoose.Types.ObjectId(targetUserObjectId) },
            { respondentId: new mongoose.Types.ObjectId(targetUserObjectId) },
            { petitionerAttId: new mongoose.Types.ObjectId(targetUserObjectId) },
            { respondentAttId: new mongoose.Types.ObjectId(targetUserObjectId) }
          ]
        };
        caseDoc = await CaseModel.findOne(participantFilter)
          .sort({ createdAt: -1, _id: -1 })
          .populate('petitionerId', 'uname firstName lastName')
          .populate('respondentId', 'uname firstName lastName')
          .lean<any>();
      }

      const pdf = await loadTemplatePdf(formKey);
      // The official templates include instruction pages before the fillable form.
      // Do not include those pages in the generated output.
      stripLeadingInstructionPages(pdf, 3);
      const form = pdf.getForm();

      const formFieldNames: string[] = (() => {
        try {
          return form.getFields().map((f: any) => String(f?.getName?.() ?? '')).filter(Boolean);
        } catch {
          return [];
        }
      })();

      function findFieldName(needle: string): string | null {
        const n = String(needle ?? '').trim().toLowerCase();
        if (!n) return null;
        // Prefer exact match; fall back to substring match.
        const exact = formFieldNames.find((x) => x.toLowerCase() === n);
        if (exact) return exact;
        const partial = formFieldNames.find((x) => x.toLowerCase().includes(n));
        return partial ?? null;
      }

      function setTextByNeedle(needle: string, value: string) {
        const name = findFieldName(needle);
        if (!name) return;
        setTextIfExists(form, name, value);
      }

      function checkByNeedle(needle: string, checked: boolean) {
        const name = findFieldName(needle);
        if (!name) return;
        checkIfExists(form, name, checked);
      }

      function formatMoney(amount: number | null | undefined): string {
        const n = Number(amount);
        if (!Number.isFinite(n)) return '';
        return n.toFixed(2);
      }

      function sumAmounts(rows: any[] | null | undefined): number {
        if (!rows || rows.length === 0) return 0;
        return rows.reduce((acc, r) => {
          const amt = Number(r?.amount ?? 0);
          return acc + (Number.isFinite(amt) ? amt : 0);
        }, 0);
      }

      function sumByTypeId(rows: any[] | null | undefined): Map<number, number> {
        const m = new Map<number, number>();
        if (!rows) return m;
        for (const r of rows) {
          const typeId = Number(r?.typeId);
          const amt = Number(r?.amount);
          if (!Number.isFinite(typeId) || !Number.isFinite(amt)) continue;
          m.set(typeId, (m.get(typeId) ?? 0) + amt);
        }
        return m;
      }

      // Collect affidavit data already stored in Mongo.
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

      const name = userFullName(user);
      const primaryEmployment = employment?.[0] ?? null;
      const employer = String(primaryEmployment?.name ?? '').trim();
      const payRate = primaryEmployment?.payRate;
      const payFrequencyTypeId = asFiniteNumber(primaryEmployment?.payFrequencyTypeId);

      // ---- Minimal mapping (expand as we map more fields) ----
      // Case caption (best-effort)
      if (caseDoc) {
        const [circuitName, countyName] = await Promise.all([
          lookupName('lookup_circuits', asFiniteNumber(caseDoc?.circuitId)),
          lookupName('lookup_counties', asFiniteNumber(caseDoc?.countyId))
        ]);

        const petitionerObj = caseDoc?.petitionerId;
        const respondentObj = caseDoc?.respondentId;
        const petitionerId = petitionerObj?._id?.toString?.() ?? petitionerObj?.toString?.();
        const respondentId = respondentObj?._id?.toString?.() ?? respondentObj?.toString?.();

        const petitionerName = petitionerObj && petitionerObj.firstName != null ? userDisplayName(petitionerObj) : '';
        const respondentName = respondentObj && respondentObj.firstName != null ? userDisplayName(respondentObj) : '';

        // If populate didn't hydrate, fall back to lookup by id.
        const [petitionerUser, respondentUser] = await Promise.all([
          !petitionerName && petitionerId && mongoose.isValidObjectId(petitionerId)
            ? User.findById(petitionerId).select({ uname: 1, firstName: 1, lastName: 1 }).lean<any>()
            : Promise.resolve(null),
          !respondentName && respondentId && mongoose.isValidObjectId(respondentId)
            ? User.findById(respondentId).select({ uname: 1, firstName: 1, lastName: 1 }).lean<any>()
            : Promise.resolve(null)
        ]);

        const finalPetitionerName = petitionerName || (petitionerUser ? userDisplayName(petitionerUser) : '');
        const finalRespondentName = respondentName || (respondentUser ? userDisplayName(respondentUser) : '');

        setTextIfExists(form, 'Case No', String(caseDoc?.caseNumber ?? '').trim());
        setTextIfExists(form, 'Division', String(caseDoc?.division ?? '').trim());

        // Short form caption fields
        if (circuitName) setTextIfExists(form, 'Circuit No', circuitName);
        if (countyName) setTextIfExists(form, 'county', countyName);

        if (circuitName) {
          // Template usually reads: "IN THE CIRCUIT COURT OF THE ____ JUDICIAL CIRCUIT".
          setTextIfExists(form, 'IN THE CIRCUIT COURT OF THE', circuitName);
        }
        if (countyName) {
          // Template usually reads: "IN AND FOR ____ COUNTY, FLORIDA".
          // Your template expects just the county name.
          setTextIfExists(form, 'IN AND FOR', countyName);
        }
        if (finalPetitionerName) setTextIfExists(form, 'Petitioner', finalPetitionerName);
        if (finalRespondentName) setTextIfExists(form, 'Respondent', finalRespondentName);
      }

      if (formKey === 'short') {
        // Short form financial affidavit (12.902(b) style).
        setTextIfExists(form, 'full legal name', name);
        // Back-compat if the template uses a slightly different name.
        setTextByNeedle('full legal name 1', name);

        const occupation = String(primaryEmployment?.occupation ?? '').trim();
        if (occupation) setTextIfExists(form, 'occupation', occupation);
        if (employer) setTextIfExists(form, 'employed by', employer);
        if (payRate != null && Number.isFinite(Number(payRate))) {
          setTextIfExists(form, 'pay rate', String(payRate));
        }

        // Pay frequency checkboxes in short form
        if (payFrequencyTypeId != null) {
          checkIfExists(form, 'every week check box', payFrequencyTypeId === 1);
          checkIfExists(form, 'every other week check box', payFrequencyTypeId === 2);
          checkIfExists(form, 'twice a month check box', payFrequencyTypeId === 4);
          checkIfExists(form, 'monthly check box', payFrequencyTypeId === 3);
          checkIfExists(form, 'other check box', ![1, 2, 3, 4].includes(payFrequencyTypeId));
        }

        // Unemployed check box when no employment rows are present.
        checkIfExists(form, 'unemployed check box', !(employment && employment.length > 0));

        // Income section
        const incomeByType = sumByTypeId(monthlyIncome);
        const alimonyThisCase = incomeByType.get(9) ?? 0;
        const alimonyOtherCases = incomeByType.get(10) ?? 0;
        const alimonyTotal = alimonyThisCase + alimonyOtherCases;

        setTextIfExists(form, 'monthly gross salary or wages', formatMoney(incomeByType.get(1)));
        setTextByNeedle('monthly bonuses, commissions', formatMoney(incomeByType.get(2)));
        setTextByNeedle('monthly business income', formatMoney(incomeByType.get(3)));
        setTextByNeedle('monthly disability', formatMoney(incomeByType.get(4)));
        setTextByNeedle('monthly workers', formatMoney(incomeByType.get(5)));
        setTextByNeedle('monthly unemployment', formatMoney(incomeByType.get(6)));
        setTextByNeedle('monthly pension', formatMoney(incomeByType.get(7)));
        setTextByNeedle('monthly social security', formatMoney(incomeByType.get(8)));
        setTextByNeedle('monthly interest and dividends', formatMoney(incomeByType.get(11)));
        setTextByNeedle('monthly rental income', formatMoney(incomeByType.get(12)));
        setTextByNeedle('royalties, trusts, or estates', formatMoney(incomeByType.get(13)));
        setTextByNeedle('monthly reimbursed expenses', formatMoney(incomeByType.get(14)));
        setTextByNeedle('monthly gains derived', formatMoney(incomeByType.get(15)));

        if (alimonyTotal > 0) {
          setTextByNeedle('monthly alimony actually received', formatMoney(alimonyTotal));
        }
        if (alimonyThisCase > 0) setTextIfExists(form, 'alimony from this case', formatMoney(alimonyThisCase));
        if (alimonyOtherCases > 0) setTextIfExists(form, 'alimony From other cases', formatMoney(alimonyOtherCases));

        const otherIncomeRow = (monthlyIncome ?? []).find((r: any) => Number(r?.typeId) === 16);
        const otherIncomeAmount = incomeByType.get(16) ?? 0;
        const otherIncomeSource = String(otherIncomeRow?.ifOther ?? '').trim();
        if (otherIncomeAmount > 0) setTextByNeedle('any other income of a', formatMoney(otherIncomeAmount));
        if (otherIncomeSource) setTextByNeedle('other income of a recurring nature source', otherIncomeSource);

        const totalMonthlyIncome = sumAmounts(monthlyIncome);
        if (totalMonthlyIncome > 0) {
          setTextByNeedle('total present monthly gross income', formatMoney(totalMonthlyIncome));
        }

        // Deductions
        const deductionsByType = sumByTypeId(monthlyDeductions);
        setTextByNeedle('monthly federal, state, and local income tax', formatMoney(deductionsByType.get(1)));
        setTextByNeedle('monthly fica or self-employment taxes', formatMoney(deductionsByType.get(2)));
        setTextByNeedle('monthly medicare payments', formatMoney(deductionsByType.get(3)));
        setTextByNeedle('monthly mandatory union dues', formatMoney(deductionsByType.get(4)));
        setTextByNeedle('monthly mandatory retirement payments', formatMoney(deductionsByType.get(5)));
        setTextByNeedle('monthly health insurance payments', formatMoney(deductionsByType.get(6)));
        setTextByNeedle('monthly court-ordered child support actually paid', formatMoney(deductionsByType.get(7)));
        setTextByNeedle('monthly court-ordered alimony actually paid', formatMoney(deductionsByType.get(8)));
        setTextByNeedle('25b from other cases', formatMoney(deductionsByType.get(9)));
        setTextByNeedle('25b', formatMoney(deductionsByType.get(9)));

        const totalMonthlyDeductions = sumAmounts(monthlyDeductions);
        if (totalMonthlyDeductions > 0) {
          setTextByNeedle('total deductions allowable under section 61.30', formatMoney(totalMonthlyDeductions));
        }

        const netMonthly = totalMonthlyIncome - totalMonthlyDeductions;
        if (Number.isFinite(netMonthly)) {
          setTextByNeedle('present net monthly income', formatMoney(netMonthly));
          setTextByNeedle('total present monthly net income', formatMoney(netMonthly));
        }

        // Household expenses (subset we can map)
        const expensesByType = sumByTypeId(monthlyHouseholdExpenses);
        const mortgageRent = expensesByType.get(1) ?? 0;
        const propertyTaxes = expensesByType.get(2) ?? 0;
        const telephone = expensesByType.get(7) ?? 0;
        const food = expensesByType.get(14) ?? 0;
        const meals = expensesByType.get(15) ?? 0;
        const maintenance = expensesByType.get(9) ?? 0;

        // Utilities: electricity + water/garbage/sewer + fuel oil/natural gas
        const utilities = (expensesByType.get(5) ?? 0) + (expensesByType.get(6) ?? 0) + (expensesByType.get(8) ?? 0);

        if (mortgageRent > 0) setTextByNeedle('mortgage or rent', formatMoney(mortgageRent));
        if (propertyTaxes > 0) setTextIfExists(form, 'property taxes', formatMoney(propertyTaxes));
        if (utilities > 0) setTextIfExists(form, 'utilities', formatMoney(utilities));
        if (telephone > 0) setTextIfExists(form, 'telephone', formatMoney(telephone));
        if (food > 0) setTextIfExists(form, 'food', formatMoney(food));
        if (meals > 0) setTextIfExists(form, 'meals outside home', formatMoney(meals));
        if (maintenance > 0) setTextIfExists(form, 'maintenance repairs', formatMoney(maintenance));

        const otherHouseRow = (monthlyHouseholdExpenses ?? []).find((r: any) => Number(r?.typeId) === 20);
        const otherHouseAmt = expensesByType.get(20) ?? 0;
        const otherHouseDesc = String(otherHouseRow?.ifOther ?? '').trim();
        if (otherHouseDesc) setTextIfExists(form, 'other 2', otherHouseDesc);
        if (otherHouseAmt > 0) setTextIfExists(form, 'other amount 2', formatMoney(otherHouseAmt));

        const totalMonthlyHousehold = sumAmounts(monthlyHouseholdExpenses);
        if (totalMonthlyHousehold > 0) {
          setTextByNeedle('total monthly expenses 1', formatMoney(totalMonthlyHousehold));
          setTextByNeedle('total monthly expenses 2', formatMoney(totalMonthlyHousehold));
        }

        const surplus = netMonthly - totalMonthlyHousehold;
        if (Number.isFinite(surplus)) {
          if (surplus >= 0) {
            setTextByNeedle('surplus', formatMoney(surplus));
            setTextByNeedle('deficit', '');
          } else {
            setTextByNeedle('deficit', formatMoney(Math.abs(surplus)));
            setTextByNeedle('surplus', '');
          }
        }

        const today = new Date().toLocaleDateString();
        setTextByNeedle('date', today);
        setTextByNeedle('dated', today);
      }

      if (formKey === 'long') {
        // Long form financial affidavit (12.902(c) style) contains income section fields.
        setTextIfExists(form, 'I full legal name', name);
        if (employer) setTextIfExists(form, 'Employed by', employer);
        const occupation = String(primaryEmployment?.occupation ?? '').trim();
        if (occupation) setTextIfExists(form, 'My occupation is', occupation);
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

        // ---- Monthly income (typeId maps to numbered fields) ----
        const incomeByType = sumByTypeId(monthlyIncome);
        // Most income items map to fields "1".."16".
        for (let typeId = 1; typeId <= 16; typeId += 1) {
          const amt = incomeByType.get(typeId);
          if (amt == null) continue;

          // The template uses explicit a/b fields for alimony received.
          if (typeId === 9) setTextIfExists(form, '9a From this case', formatMoney(amt));
          else if (typeId === 10) setTextIfExists(form, '9b From other cases', formatMoney(amt));
          else setTextIfExists(form, String(typeId), formatMoney(amt));
        }

        // "Other" income description (typeId=16)
        const otherIncomeRow = (monthlyIncome ?? []).find((r: any) => Number(r?.typeId) === 16);
        const otherIncomeSource = String(otherIncomeRow?.ifOther ?? '').trim();
        if (otherIncomeSource) {
          setTextIfExists(form, 'Any other income of a recurring nature identify source', otherIncomeSource);
        }

        const totalMonthlyIncome = sumAmounts(monthlyIncome);
        if (totalMonthlyIncome > 0) {
          // On this template revision, fields 17/18 represent income totals.
          setTextIfExists(form, '17', formatMoney(totalMonthlyIncome));
          setTextIfExists(form, '18', formatMoney(totalMonthlyIncome * 12));
        }

        // ---- Monthly deductions (typeId maps to numbered fields 19..26) ----
        const deductionsByType = sumByTypeId(monthlyDeductions);
        const deductionFieldByTypeId = new Map<number, string>([
          [1, '19'],
          [2, '20'],
          [3, '21'],
          [4, '22'],
          [5, '23'],
          [6, '24'],
          [7, '25'],
          [8, '25a From this case'],
          [9, '25b From other cases'],
          [10, '26']
        ]);
        for (const [typeId, fieldName] of deductionFieldByTypeId.entries()) {
          const amt = deductionsByType.get(typeId);
          if (amt == null) continue;
          setTextIfExists(form, fieldName, formatMoney(amt));
        }

        // Field 27 is the last line in Section I (commonly used for total deductions).
        const totalMonthlyDeductions = sumAmounts(monthlyDeductions);
        if (totalMonthlyDeductions > 0) {
          setTextIfExists(form, '27', formatMoney(totalMonthlyDeductions));
        }

        // ---- Monthly household expenses (typeId maps to fields 1_2..20_2) ----
        const expensesByType = sumByTypeId(monthlyHouseholdExpenses);
        for (let typeId = 1; typeId <= 20; typeId += 1) {
          const amt = expensesByType.get(typeId);
          if (amt == null) continue;
          setTextIfExists(form, `${typeId}_2`, formatMoney(amt));
        }

        // ---- Minimal best-effort assets/liabilities ----
        // The long template has complex tables with many fields; for now we populate the
        // dedicated "Other ... RowN" fields when present.
        const otherAssetsRows = (assets ?? [])
          .filter((r: any) => Number(r?.assetsTypeId) === 19)
          .slice(0, 7)
          .map((r: any) => {
            const desc = String(r?.description ?? '').trim();
            const val = formatMoney(r?.marketValue);
            return [desc, val].filter(Boolean).join(' — ');
          });
        for (let i = 0; i < otherAssetsRows.length; i += 1) {
          setTextIfExists(form, `Other assetsRow${i + 1}`, otherAssetsRows[i]!);
        }

        const otherLiabilitiesRows = (liabilities ?? [])
          .filter((r: any) => Number(r?.liabilitiesTypeId) === 9)
          .slice(0, 6)
          .map((r: any) => {
            const desc = String(r?.description ?? '').trim();
            const owed = formatMoney(r?.amountOwed);
            return [desc, owed].filter(Boolean).join(' — ');
          });
        for (let i = 0; i < otherLiabilitiesRows.length; i += 1) {
          setTextIfExists(form, `Other liabilitiesRow${i + 1}`, otherLiabilitiesRows[i]!);
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
      res.setHeader('Content-Disposition', `attachment; filename="financial-affidavit-${formKey}.pdf"`);
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
