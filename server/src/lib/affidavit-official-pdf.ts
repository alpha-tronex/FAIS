import mongoose from 'mongoose';
import { CaseModel, User } from '../models.js';
import { asFiniteNumber } from './number.js';
import {
  loadTemplatePdf,
  stripLeadingInstructionPages,
  setTextIfExists,
  checkIfExists,
  formatMoneyDecimal,
  lookupName,
  type PdfTemplateKey
} from './affidavit-pdf.js';
import { userFullName, userDisplayName, caseIncludesUser } from './affidavit-helpers.js';
import { userScopedFilter, listAffidavitRows } from './affidavit-store.js';
import type { AuthPayload } from '../routes/middleware.js';

export type FillOfficialAffidavitParams = {
  targetUserObjectId: string;
  formKey: PdfTemplateKey;
  caseId?: string;
  auth: AuthPayload;
};

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

export async function fillOfficialAffidavitPdf(params: FillOfficialAffidavitParams): Promise<Buffer> {
  const { targetUserObjectId, formKey, caseId: requestedCaseId, auth } = params;

  const user = await User.findById(targetUserObjectId).lean<any>();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  let caseDoc: any | null = null;

  if (requestedCaseId) {
    if (!mongoose.isValidObjectId(requestedCaseId)) {
      throw Object.assign(new Error('Invalid caseId'), { status: 400 });
    }
    caseDoc = await CaseModel.findById(requestedCaseId)
      .populate('petitionerId', 'uname firstName lastName')
      .populate('respondentId', 'uname firstName lastName')
      .lean<any>();
    if (!caseDoc) throw Object.assign(new Error('Case not found'), { status: 404 });
    if (!caseIncludesUser(caseDoc, targetUserObjectId)) {
      throw Object.assign(new Error('caseId does not belong to target user'), { status: 400 });
    }
    if (auth.roleTypeId !== 5 && !caseIncludesUser(caseDoc, auth.sub)) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
  } else {
    const participantFilter: Record<string, unknown> = {
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

  if (caseDoc) {
    const [circuitName, countyName] = await Promise.all([
      lookupName('lookup_circuits', asFiniteNumber(caseDoc?.circuitId)),
      lookupName('lookup_counties', asFiniteNumber(caseDoc?.countyId))
    ]);

    const petitionerObj = caseDoc?.petitionerId;
    const respondentObj = caseDoc?.respondentId;
    const petitionerId = petitionerObj?._id?.toString?.() ?? (petitionerObj as any)?.toString?.();
    const respondentId = respondentObj?._id?.toString?.() ?? (respondentObj as any)?.toString?.();

    const petitionerName = petitionerObj && (petitionerObj as any).firstName != null ? userDisplayName(petitionerObj as any) : '';
    const respondentName = respondentObj && (respondentObj as any).firstName != null ? userDisplayName(respondentObj as any) : '';

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
    if (circuitName) setTextIfExists(form, 'Circuit No', circuitName);
    if (countyName) setTextIfExists(form, 'county', countyName);
    if (circuitName) setTextIfExists(form, 'IN THE CIRCUIT COURT OF THE', circuitName);
    if (countyName) setTextIfExists(form, 'IN AND FOR', countyName);
    if (finalPetitionerName) setTextIfExists(form, 'Petitioner', finalPetitionerName);
    if (finalRespondentName) setTextIfExists(form, 'Respondent', finalRespondentName);
  }

  if (formKey === 'short') {
    setTextIfExists(form, 'full legal name', name);
    setTextByNeedle('full legal name 1', name);

    const occupation = String(primaryEmployment?.occupation ?? '').trim();
    if (occupation) setTextIfExists(form, 'occupation', occupation);
    if (employer) setTextIfExists(form, 'employed by', employer);
    if (payRate != null && Number.isFinite(Number(payRate))) {
      setTextIfExists(form, 'pay rate', String(payRate));
    }

    if (payFrequencyTypeId != null) {
      checkIfExists(form, 'every week check box', payFrequencyTypeId === 1);
      checkIfExists(form, 'every other week check box', payFrequencyTypeId === 2);
      checkIfExists(form, 'twice a month check box', payFrequencyTypeId === 4);
      checkIfExists(form, 'monthly check box', payFrequencyTypeId === 3);
      checkIfExists(form, 'other check box', ![1, 2, 3, 4].includes(payFrequencyTypeId));
    }
    checkIfExists(form, 'unemployed check box', !(employment && employment.length > 0));

    const incomeByType = sumByTypeId(monthlyIncome);
    const alimonyThisCase = incomeByType.get(9) ?? 0;
    const alimonyOtherCases = incomeByType.get(10) ?? 0;
    const alimonyTotal = alimonyThisCase + alimonyOtherCases;

    setTextIfExists(form, 'monthly gross salary or wages', formatMoneyDecimal(incomeByType.get(1)));
    setTextByNeedle('monthly bonuses, commissions', formatMoneyDecimal(incomeByType.get(2)));
    setTextByNeedle('monthly business income', formatMoneyDecimal(incomeByType.get(3)));
    setTextByNeedle('monthly disability', formatMoneyDecimal(incomeByType.get(4)));
    setTextByNeedle('monthly workers', formatMoneyDecimal(incomeByType.get(5)));
    setTextByNeedle('monthly unemployment', formatMoneyDecimal(incomeByType.get(6)));
    setTextByNeedle('monthly pension', formatMoneyDecimal(incomeByType.get(7)));
    setTextByNeedle('monthly social security', formatMoneyDecimal(incomeByType.get(8)));
    setTextByNeedle('monthly interest and dividends', formatMoneyDecimal(incomeByType.get(11)));
    setTextByNeedle('monthly rental income', formatMoneyDecimal(incomeByType.get(12)));
    setTextByNeedle('royalties, trusts, or estates', formatMoneyDecimal(incomeByType.get(13)));
    setTextByNeedle('monthly reimbursed expenses', formatMoneyDecimal(incomeByType.get(14)));
    setTextByNeedle('monthly gains derived', formatMoneyDecimal(incomeByType.get(15)));
    if (alimonyTotal > 0) setTextByNeedle('monthly alimony actually received', formatMoneyDecimal(alimonyTotal));
    if (alimonyThisCase > 0) setTextIfExists(form, 'alimony from this case', formatMoneyDecimal(alimonyThisCase));
    if (alimonyOtherCases > 0) setTextIfExists(form, 'alimony From other cases', formatMoneyDecimal(alimonyOtherCases));

    const otherIncomeRow = (monthlyIncome ?? []).find((r: any) => Number(r?.typeId) === 16);
    const otherIncomeAmount = incomeByType.get(16) ?? 0;
    const otherIncomeSource = String(otherIncomeRow?.ifOther ?? '').trim();
    if (otherIncomeAmount > 0) setTextByNeedle('any other income of a', formatMoneyDecimal(otherIncomeAmount));
    if (otherIncomeSource) setTextByNeedle('other income of a recurring nature source', otherIncomeSource);

    const totalMonthlyIncome = sumAmounts(monthlyIncome);
    if (totalMonthlyIncome > 0) setTextByNeedle('total present monthly gross income', formatMoneyDecimal(totalMonthlyIncome));

    const deductionsByType = sumByTypeId(monthlyDeductions);
    setTextByNeedle('monthly federal, state, and local income tax', formatMoneyDecimal(deductionsByType.get(1)));
    setTextByNeedle('monthly fica or self-employment taxes', formatMoneyDecimal(deductionsByType.get(2)));
    setTextByNeedle('monthly medicare payments', formatMoneyDecimal(deductionsByType.get(3)));
    setTextByNeedle('monthly mandatory union dues', formatMoneyDecimal(deductionsByType.get(4)));
    setTextByNeedle('monthly mandatory retirement payments', formatMoneyDecimal(deductionsByType.get(5)));
    setTextByNeedle('monthly health insurance payments', formatMoneyDecimal(deductionsByType.get(6)));
    setTextByNeedle('monthly court-ordered child support actually paid', formatMoneyDecimal(deductionsByType.get(7)));
    setTextByNeedle('monthly court-ordered alimony actually paid', formatMoneyDecimal(deductionsByType.get(8)));
    setTextByNeedle('25b from other cases', formatMoneyDecimal(deductionsByType.get(9)));
    setTextByNeedle('25b', formatMoneyDecimal(deductionsByType.get(9)));

    const totalMonthlyDeductions = sumAmounts(monthlyDeductions);
    if (totalMonthlyDeductions > 0) {
      setTextByNeedle('total deductions allowable under section 61.30', formatMoneyDecimal(totalMonthlyDeductions));
    }

    const netMonthly = totalMonthlyIncome - totalMonthlyDeductions;
    if (Number.isFinite(netMonthly)) {
      setTextByNeedle('present net monthly income', formatMoneyDecimal(netMonthly));
      setTextByNeedle('total present monthly net income', formatMoneyDecimal(netMonthly));
    }

    const expensesByType = sumByTypeId(monthlyHouseholdExpenses);
    const mortgageRent = expensesByType.get(1) ?? 0;
    const propertyTaxes = expensesByType.get(2) ?? 0;
    const telephone = expensesByType.get(7) ?? 0;
    const food = expensesByType.get(14) ?? 0;
    const meals = expensesByType.get(15) ?? 0;
    const maintenance = expensesByType.get(9) ?? 0;
    const utilities = (expensesByType.get(5) ?? 0) + (expensesByType.get(6) ?? 0) + (expensesByType.get(8) ?? 0);

    if (mortgageRent > 0) setTextByNeedle('mortgage or rent', formatMoneyDecimal(mortgageRent));
    if (propertyTaxes > 0) setTextIfExists(form, 'property taxes', formatMoneyDecimal(propertyTaxes));
    if (utilities > 0) setTextIfExists(form, 'utilities', formatMoneyDecimal(utilities));
    if (telephone > 0) setTextIfExists(form, 'telephone', formatMoneyDecimal(telephone));
    if (food > 0) setTextIfExists(form, 'food', formatMoneyDecimal(food));
    if (meals > 0) setTextIfExists(form, 'meals outside home', formatMoneyDecimal(meals));
    if (maintenance > 0) setTextIfExists(form, 'maintenance repairs', formatMoneyDecimal(maintenance));

    const otherHouseRow = (monthlyHouseholdExpenses ?? []).find((r: any) => Number(r?.typeId) === 20);
    const otherHouseAmt = expensesByType.get(20) ?? 0;
    const otherHouseDesc = String(otherHouseRow?.ifOther ?? '').trim();
    if (otherHouseDesc) setTextIfExists(form, 'other 2', otherHouseDesc);
    if (otherHouseAmt > 0) setTextIfExists(form, 'other amount 2', formatMoneyDecimal(otherHouseAmt));

    const totalMonthlyHousehold = sumAmounts(monthlyHouseholdExpenses);
    if (totalMonthlyHousehold > 0) {
      setTextByNeedle('total monthly expenses 1', formatMoneyDecimal(totalMonthlyHousehold));
      setTextByNeedle('total monthly expenses 2', formatMoneyDecimal(totalMonthlyHousehold));
    }

    const surplus = netMonthly - totalMonthlyHousehold;
    if (Number.isFinite(surplus)) {
      if (surplus >= 0) {
        setTextByNeedle('surplus', formatMoneyDecimal(surplus));
        setTextByNeedle('deficit', '');
      } else {
        setTextByNeedle('deficit', formatMoneyDecimal(Math.abs(surplus)));
        setTextByNeedle('surplus', '');
      }
    }

    const today = new Date().toLocaleDateString();
    setTextByNeedle('date', today);
    setTextByNeedle('dated', today);
  }

  if (formKey === 'long') {
    setTextIfExists(form, 'I full legal name', name);
    if (employer) setTextIfExists(form, 'Employed by', employer);
    const occupation = String(primaryEmployment?.occupation ?? '').trim();
    if (occupation) setTextIfExists(form, 'My occupation is', occupation);
    if (payRate != null && Number.isFinite(Number(payRate))) {
      setTextIfExists(form, 'Pay rate', String(payRate));
    }
    if (payFrequencyTypeId != null) {
      checkIfExists(form, 'Hourly', payFrequencyTypeId === 9);
      checkIfExists(form, 'Weekly', payFrequencyTypeId === 1);
      checkIfExists(form, 'Biweekly', payFrequencyTypeId === 2);
      checkIfExists(form, 'Monthly', payFrequencyTypeId === 3);
    }

    const incomeByType = sumByTypeId(monthlyIncome);
    for (let typeId = 1; typeId <= 16; typeId += 1) {
      const amt = incomeByType.get(typeId);
      if (amt == null) continue;
      if (typeId === 9) setTextIfExists(form, '9a From this case', formatMoneyDecimal(amt));
      else if (typeId === 10) setTextIfExists(form, '9b From other cases', formatMoneyDecimal(amt));
      else setTextIfExists(form, String(typeId), formatMoneyDecimal(amt));
    }

    const otherIncomeRow = (monthlyIncome ?? []).find((r: any) => Number(r?.typeId) === 16);
    const otherIncomeSource = String(otherIncomeRow?.ifOther ?? '').trim();
    if (otherIncomeSource) {
      setTextIfExists(form, 'Any other income of a recurring nature identify source', otherIncomeSource);
    }

    const totalMonthlyIncome = sumAmounts(monthlyIncome);
    if (totalMonthlyIncome > 0) {
      setTextIfExists(form, '17', formatMoneyDecimal(totalMonthlyIncome));
      setTextIfExists(form, '18', formatMoneyDecimal(totalMonthlyIncome * 12));
    }

    const deductionsByType = sumByTypeId(monthlyDeductions);
    const deductionFieldByTypeId = new Map<number, string>([
      [1, '19'], [2, '20'], [3, '21'], [4, '22'], [5, '23'], [6, '24'], [7, '25'],
      [8, '25a From this case'], [9, '25b From other cases'], [10, '26']
    ]);
    for (const [typeId, fieldName] of deductionFieldByTypeId.entries()) {
      const amt = deductionsByType.get(typeId);
      if (amt == null) continue;
      setTextIfExists(form, fieldName, formatMoneyDecimal(amt));
    }

    const totalMonthlyDeductions = sumAmounts(monthlyDeductions);
    if (totalMonthlyDeductions > 0) {
      setTextIfExists(form, '27', formatMoneyDecimal(totalMonthlyDeductions));
    }

    const expensesByType = sumByTypeId(monthlyHouseholdExpenses);
    for (let typeId = 1; typeId <= 20; typeId += 1) {
      const amt = expensesByType.get(typeId);
      if (amt == null) continue;
      setTextIfExists(form, `${typeId}_2`, formatMoneyDecimal(amt));
    }

    const otherAssetsRows = (assets ?? [])
      .filter((r: any) => Number(r?.assetsTypeId) === 19)
      .slice(0, 7)
      .map((r: any) => {
        const desc = String(r?.description ?? '').trim();
        const val = formatMoneyDecimal(r?.marketValue);
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
        const owed = formatMoneyDecimal(r?.amountOwed);
        return [desc, owed].filter(Boolean).join(' — ');
      });
    for (let i = 0; i < otherLiabilitiesRows.length; i += 1) {
      setTextIfExists(form, `Other liabilitiesRow${i + 1}`, otherLiabilitiesRows[i]!);
    }
  }

  try {
    form.flatten();
  } catch {
    // Some PDFs may not support flattening cleanly; still return filled.
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
