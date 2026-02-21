import type { AffidavitSummary } from './affidavit-summary.js';
import { asFiniteNumber } from './number.js';
import { escapeHtml, formatMoney } from './affidavit-pdf.js';

export type AffidavitHtmlData = {
  targetUserObjectId: string;
  form: 'short' | 'long';
  summary: AffidavitSummary;
  employment: any[];
  monthlyIncome: any[];
  monthlyDeductions: any[];
  monthlyHouseholdExpenses: any[];
  assets: any[];
  liabilities: any[];
};

export function buildAffidavitHtml(data: AffidavitHtmlData): string {
  const {
    targetUserObjectId,
    form,
    summary,
    employment,
    monthlyIncome,
    monthlyDeductions,
    monthlyHouseholdExpenses,
    assets,
    liabilities
  } = data;

  const title = `Financial Affidavit (${form === 'short' ? 'Short' : 'Long'})`;

  return `<!doctype html>
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
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'Letter', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
