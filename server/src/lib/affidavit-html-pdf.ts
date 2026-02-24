import type { AffidavitSummary } from './affidavit-summary.js';
import { asFiniteNumber } from './number.js';
import { escapeHtml, formatMoney } from './affidavit-pdf.js';

export type LookupItem = { id: number; name: string };

function sumAmounts(rows: any[] | null | undefined): number {
  if (!rows || rows.length === 0) return 0;
  return rows.reduce((acc, r) => {
    const amt = Number(r?.amount ?? 0);
    return acc + (Number.isFinite(amt) ? amt : 0);
  }, 0);
}

function typeLabel(typeId: number | null | undefined, types: LookupItem[] | undefined): string {
  if (types == null || types.length === 0) return typeId != null ? String(typeId) : '';
  const id = asFiniteNumber(typeId);
  if (id == null) return '';
  const found = types.find((t) => t.id === id);
  return found ? found.name : String(id);
}

export type AffidavitHtmlData = {
  targetUserObjectId: string;
  form: 'short' | 'long';
  summary: AffidavitSummary;
  employment: any[];
  monthlyIncome: any[];
  monthlyDeductions: any[];
  monthlyHouseholdExpenses: any[];
  monthlyAutomobileExpenses: any[];
  monthlyChildrenExpenses: any[];
  monthlyChildrenOtherExpenses: any[];
  monthlyCreditorsExpenses: any[];
  monthlyInsuranceExpenses: any[];
  monthlyOtherExpenses: any[];
  assets: any[];
  liabilities: any[];
  contingentAssets: any[];
  contingentLiabilities: any[];
  lookups?: {
    payFrequencyTypes?: LookupItem[];
    incomeTypes?: LookupItem[];
    deductionTypes?: LookupItem[];
    householdExpenseTypes?: LookupItem[];
    automobileExpenseTypes?: LookupItem[];
    childrenExpenseTypes?: LookupItem[];
    childrenOtherExpenseTypes?: LookupItem[];
    creditorsExpenseTypes?: LookupItem[];
    insuranceExpenseTypes?: LookupItem[];
    otherExpenseTypes?: LookupItem[];
    assetsTypes?: LookupItem[];
    liabilitiesTypes?: LookupItem[];
    nonMaritalTypes?: LookupItem[];
  };
};

function expenseTable(
  title: string,
  rows: any[],
  types: LookupItem[] | undefined
): string {
  const list = rows?.length ? rows : [{}];
  return `
    <h2>${escapeHtml(title)}</h2>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Description (if other)</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${list
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(typeLabel(r.typeId, types))}</td>
            <td>${escapeHtml(r.ifOther ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.amount))}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
    ${rows?.length ? `<p><span class="k">Total:</span> ${escapeHtml(formatMoney(sumAmounts(rows)))}</p>` : ''}`;
}

export function buildAffidavitHtml(data: AffidavitHtmlData): string {
  const {
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
    lookups
  } = data;

  const totalMonthlyIncome = sumAmounts(monthlyIncome);
  const totalMonthlyDeductions = sumAmounts(monthlyDeductions);
  const netMonthly = totalMonthlyIncome - totalMonthlyDeductions;
  const totalHousehold = sumAmounts(monthlyHouseholdExpenses);
  const totalAutomobile = sumAmounts(monthlyAutomobileExpenses);
  const totalChildren = sumAmounts(monthlyChildrenExpenses);
  const totalChildrenOther = sumAmounts(monthlyChildrenOtherExpenses);
  const totalCreditors = sumAmounts(monthlyCreditorsExpenses);
  const totalInsurance = sumAmounts(monthlyInsuranceExpenses);
  const totalOther = sumAmounts(monthlyOtherExpenses);
  const surplus = Number.isFinite(netMonthly) ? netMonthly - totalHousehold : null;
  const totalAssets = (assets ?? []).reduce((s: number, r: any) => s + (Number(r?.marketValue) ?? 0), 0);
  const totalLiabilities = (liabilities ?? []).reduce((s: number, r: any) => s + (Number(r?.amountOwed) ?? 0), 0);
  const totalContingentAssets = (contingentAssets ?? []).reduce((s: number, r: any) => s + (Number(r?.possibleValue) ?? 0), 0);
  const totalContingentLiabilities = (contingentLiabilities ?? []).reduce((s: number, r: any) => s + (Number(r?.possibleAmountOwed) ?? 0), 0);

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

    <h2>Short Form Summary (same values as official short form PDF)</h2>
    <table>
      <tbody>
        <tr><td class="k">Total present monthly gross income</td><td class="right">${escapeHtml(formatMoney(totalMonthlyIncome))}</td></tr>
        <tr><td class="k">Total deductions allowable under section 61.30</td><td class="right">${escapeHtml(formatMoney(totalMonthlyDeductions))}</td></tr>
        <tr><td class="k">Present net monthly income / Total present monthly net income</td><td class="right">${escapeHtml(formatMoney(netMonthly))}</td></tr>
        <tr><td class="k">Total monthly household expenses</td><td class="right">${escapeHtml(formatMoney(totalHousehold))}</td></tr>
        <tr><td class="k">Total monthly automobile expenses</td><td class="right">${escapeHtml(formatMoney(totalAutomobile))}</td></tr>
        <tr><td class="k">Total monthly children expenses</td><td class="right">${escapeHtml(formatMoney(totalChildren))}</td></tr>
        <tr><td class="k">Total monthly children other expenses</td><td class="right">${escapeHtml(formatMoney(totalChildrenOther))}</td></tr>
        <tr><td class="k">Total monthly creditors expenses</td><td class="right">${escapeHtml(formatMoney(totalCreditors))}</td></tr>
        <tr><td class="k">Total monthly insurance expenses</td><td class="right">${escapeHtml(formatMoney(totalInsurance))}</td></tr>
        <tr><td class="k">Total monthly other expenses</td><td class="right">${escapeHtml(formatMoney(totalOther))}</td></tr>
        <tr><td class="k">Surplus (net income − household expenses)</td><td class="right">${surplus != null && surplus >= 0 ? escapeHtml(formatMoney(surplus)) : '—'}</td></tr>
        <tr><td class="k">Deficit</td><td class="right">${surplus != null && surplus < 0 ? escapeHtml(formatMoney(Math.abs(surplus))) : '—'}</td></tr>
        <tr><td class="k">Total assets (market value)</td><td class="right">${escapeHtml(formatMoney(totalAssets))}</td></tr>
        <tr><td class="k">Total liabilities (amount owed)</td><td class="right">${escapeHtml(formatMoney(totalLiabilities))}</td></tr>
        <tr><td class="k">Total contingent assets (possible value)</td><td class="right">${escapeHtml(formatMoney(totalContingentAssets))}</td></tr>
        <tr><td class="k">Total contingent liabilities (possible amount owed)</td><td class="right">${escapeHtml(formatMoney(totalContingentLiabilities))}</td></tr>
      </tbody>
    </table>

    <h2>Employment</h2>
    <table>
      <thead>
        <tr>
          <th>Employer</th>
          <th>Pay rate</th>
          <th>Pay frequency</th>
        </tr>
      </thead>
      <tbody>
        ${(employment.length ? employment : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(r.name ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.payRate))}</td>
            <td>${escapeHtml(typeLabel(r.payFrequencyTypeId, lookups?.payFrequencyTypes))}</td>
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
          <th>Type</th>
          <th>Description</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${(monthlyIncome.length ? monthlyIncome : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(typeLabel(r.typeId, lookups?.incomeTypes))}</td>
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
          <th>Type</th>
          <th>Description</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${(monthlyDeductions.length ? monthlyDeductions : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(typeLabel(r.typeId, lookups?.deductionTypes))}</td>
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
          <th>Type</th>
          <th>Description</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${(monthlyHouseholdExpenses.length ? monthlyHouseholdExpenses : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(typeLabel(r.typeId, lookups?.householdExpenseTypes))}</td>
            <td>${escapeHtml(r.ifOther ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.amount))}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
    ${monthlyHouseholdExpenses?.length ? `<p><span class="k">Total:</span> ${escapeHtml(formatMoney(totalHousehold))}</p>` : ''}

    ${expenseTable('Monthly Automobile Expenses', monthlyAutomobileExpenses ?? [], lookups?.automobileExpenseTypes)}
    ${expenseTable('Monthly Children Expenses', monthlyChildrenExpenses ?? [], lookups?.childrenExpenseTypes)}
    ${expenseTable('Monthly Children Other Expenses', monthlyChildrenOtherExpenses ?? [], lookups?.childrenOtherExpenseTypes)}
    ${expenseTable('Monthly Creditors Expenses', monthlyCreditorsExpenses ?? [], lookups?.creditorsExpenseTypes)}
    ${expenseTable('Monthly Insurance Expenses', monthlyInsuranceExpenses ?? [], lookups?.insuranceExpenseTypes)}
    ${expenseTable('Monthly Other Expenses', monthlyOtherExpenses ?? [], lookups?.otherExpenseTypes)}

    <h2>Assets</h2>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Description</th>
          <th class="right">Market value</th>
          <th>Non-marital type</th>
        </tr>
      </thead>
      <tbody>
        ${(assets.length ? assets : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(typeLabel(r.assetsTypeId, lookups?.assetsTypes))}</td>
            <td>${escapeHtml(r.description ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.marketValue))}</td>
            <td>${escapeHtml(typeLabel(r.nonMaritalTypeId, lookups?.nonMaritalTypes))}</td>
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
          <th>Type</th>
          <th>Description</th>
          <th class="right">Amount owed</th>
          <th>Non-marital type</th>
        </tr>
      </thead>
      <tbody>
        ${(liabilities.length ? liabilities : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(typeLabel(r.liabilitiesTypeId, lookups?.liabilitiesTypes))}</td>
            <td>${escapeHtml(r.description ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.amountOwed))}</td>
            <td>${escapeHtml(typeLabel(r.nonMaritalTypeId, lookups?.nonMaritalTypes))}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>

    <h2>Contingent Assets</h2>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="right">Possible value</th>
          <th>Party</th>
          <th>Judge award?</th>
        </tr>
      </thead>
      <tbody>
        ${((contingentAssets ?? []).length ? contingentAssets : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(r.description ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.possibleValue))}</td>
            <td>${escapeHtml(typeLabel(r.nonMaritalTypeId, lookups?.nonMaritalTypes)) || '—'}</td>
            <td>${r.judgeAward ? 'Yes' : 'No'}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
    ${(contingentAssets ?? []).length ? `<p><span class="k">Total:</span> ${escapeHtml(formatMoney(totalContingentAssets))}</p>` : ''}

    <h2>Contingent Liabilities</h2>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="right">Possible amount owed</th>
          <th>Party</th>
          <th>User owes?</th>
        </tr>
      </thead>
      <tbody>
        ${((contingentLiabilities ?? []).length ? contingentLiabilities : [{}])
          .map(
            (r: any) => `
          <tr>
            <td>${escapeHtml(r.description ?? '')}</td>
            <td class="right">${escapeHtml(formatMoney(r.possibleAmountOwed))}</td>
            <td>${escapeHtml(typeLabel(r.nonMaritalTypeId, lookups?.nonMaritalTypes)) || '—'}</td>
            <td>${r.userOwes ? 'Yes' : 'No'}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
    ${(contingentLiabilities ?? []).length ? `<p><span class="k">Total:</span> ${escapeHtml(formatMoney(totalContingentLiabilities))}</p>` : ''}

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
