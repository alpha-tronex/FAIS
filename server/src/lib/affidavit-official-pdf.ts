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

/** Non-marital type: 1 = Husband (petitioner), 2 = Wife (respondent), 3 = Both */
function isPetitionerParty(nonMaritalTypeId: number | null | undefined): boolean {
  const id = Number(nonMaritalTypeId);
  return id === 1 || id === 3;
}
function isRespondentParty(nonMaritalTypeId: number | null | undefined): boolean {
  const id = Number(nonMaritalTypeId);
  return id === 2 || id === 3;
}

type AssetTypeFlags = { value: number; judgeAward: boolean; petitioner: boolean; respondent: boolean };

/** Sum asset values and aggregate judgeAward / party flags by assetsTypeId */
function sumAssetsByTypeIdWithFlags(rows: any[] | null | undefined): Map<number, AssetTypeFlags> {
  const m = new Map<number, AssetTypeFlags>();
  if (!rows) return m;
  for (const r of rows) {
    const typeId = Number(r?.assetsTypeId);
    const val = Number(r?.marketValue);
    if (!Number.isFinite(typeId) || !Number.isFinite(val)) continue;
    const cur = m.get(typeId);
    const judgeAward = cur?.judgeAward || Boolean(r?.judgeAward);
    const petitioner = cur?.petitioner || isPetitionerParty(r?.nonMaritalTypeId);
    const respondent = cur?.respondent || isRespondentParty(r?.nonMaritalTypeId);
    m.set(typeId, {
      value: (cur?.value ?? 0) + val,
      judgeAward,
      petitioner,
      respondent
    });
  }
  return m;
}

/** Sum asset market values by assetsTypeId for short-form mapping (legacy helper) */
function sumAssetsByTypeId(rows: any[] | null | undefined): Map<number, number> {
  const withFlags = sumAssetsByTypeIdWithFlags(rows);
  const m = new Map<number, number>();
  withFlags.forEach((f, id) => m.set(id, f.value));
  return m;
}

type LiabTypeFlags = { value: number; userOwes: boolean; petitioner: boolean; respondent: boolean };

/** Sum liability amounts and aggregate userOwes / party flags by liabilitiesTypeId */
function sumLiabilitiesByTypeIdWithFlags(rows: any[] | null | undefined): Map<number, LiabTypeFlags> {
  const m = new Map<number, LiabTypeFlags>();
  if (!rows) return m;
  for (const r of rows) {
    const typeId = Number(r?.liabilitiesTypeId);
    const amt = Number(r?.amountOwed);
    if (!Number.isFinite(typeId) || !Number.isFinite(amt)) continue;
    const cur = m.get(typeId);
    const userOwes = cur?.userOwes || Boolean(r?.userOwes);
    const petitioner = cur?.petitioner || isPetitionerParty(r?.nonMaritalTypeId);
    const respondent = cur?.respondent || isRespondentParty(r?.nonMaritalTypeId);
    m.set(typeId, {
      value: (cur?.value ?? 0) + amt,
      userOwes,
      petitioner,
      respondent
    });
  }
  return m;
}

/** Sum liability amounts by liabilitiesTypeId for short-form mapping (legacy helper) */
function sumLiabilitiesByTypeId(rows: any[] | null | undefined): Map<number, number> {
  const withFlags = sumLiabilitiesByTypeIdWithFlags(rows);
  const m = new Map<number, number>();
  withFlags.forEach((f, id) => m.set(id, f.value));
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
      .populate('respondentAttId', 'uname firstName lastName')
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
      .populate('respondentAttId', 'uname firstName lastName')
      .lean<any>();
  }

  /** Other party or his/her attorney: respondent attorney if present, else respondent (for short form) */
  let otherPartyUser: { firstName?: string; lastName?: string; uname?: string; addressLine1?: string; addressLine2?: string; city?: string; state?: string; zipCode?: string; phone?: string; email?: string } | null = null;
  /** Petitioner contact block (Printed Name, address 2, etc.) for short form */
  let petitionerContactUser: { firstName?: string; lastName?: string; uname?: string; addressLine1?: string; addressLine2?: string; city?: string; state?: string; zipCode?: string; phone?: string; email?: string } | null = null;

  const pdf = await loadTemplatePdf(formKey);
  // Fill form before stripping pages so fields on any page (e.g. assets/liabilities) are present
  const form = pdf.getForm();

  const allFormFields: { name: string; field: any }[] = (() => {
    try {
      return form.getFields().map((f: any) => ({ name: String(f?.getName?.() ?? ''), field: f })).filter((x) => x.name);
    } catch {
      return [];
    }
  })();

  const formFieldNames = allFormFields.map((x) => x.name);

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

  /** Set text on ALL matching fields (same name can appear on multiple pages; we keep some pages so set all) */
  function setShortFormText(needle: string, value: string, excludeSubstring?: string) {
    const n = String(needle ?? '').trim().toLowerCase();
    if (!n) return;
    const exclude = excludeSubstring?.toLowerCase() ?? '';
    const matches = allFormFields.filter(
      (x) => {
        const nameLower = x.name.toLowerCase();
        if (!nameLower.includes(n) || (exclude && nameLower.includes(exclude))) return false;
        return typeof (x.field as any).setText === 'function';
      }
    );
    for (const entry of matches) {
      if (value !== undefined) (entry.field as any).setText(value);
    }
  }

  /** Check/uncheck ALL matching checkbox fields */
  function setShortFormCheck(needle: string, checked: boolean) {
    const n = String(needle ?? '').trim().toLowerCase();
    if (!n) return;
    const matches = allFormFields.filter(
      (x) => x.name.toLowerCase().includes(n) && typeof (x.field as any).check === 'function'
    );
    for (const entry of matches) {
      checked ? (entry.field as any).check() : (entry.field as any).uncheck();
    }
  }

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
    contingentLiabilities
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
    listAffidavitRows('contingentliability', filter)
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

    // Other party or his/her attorney: prefer respondent attorney, else respondent (for short form)
    const respondentAttObj = caseDoc?.respondentAttId;
    const otherPartyId =
      (respondentAttObj as any)?._id?.toString?.() ?? (respondentAttObj as any)?.toString?.() ?? respondentId;
    if (otherPartyId && mongoose.isValidObjectId(otherPartyId)) {
      const loaded = await User.findById(otherPartyId)
        .select({ firstName: 1, lastName: 1, uname: 1, addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1, phone: 1, email: 1 })
        .lean<any>();
      if (loaded) otherPartyUser = loaded;
    }

    // Petitioner contact (Printed Name, address 2, etc.) for short form
    if (petitionerId && mongoose.isValidObjectId(petitionerId)) {
      const loaded = await User.findById(petitionerId)
        .select({ firstName: 1, lastName: 1, uname: 1, addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1, phone: 1, email: 1 })
        .lean<any>();
      if (loaded) petitionerContactUser = loaded;
    }

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

    // Short form: automobile expenses (typeId 1–9: gasoline, repairs, tags, insurance, payments, rental, alternative transport, tolls, other)
    const autoByType = sumByTypeId(monthlyAutomobileExpenses);
    setTextByNeedle('gasoline', formatMoneyDecimal(autoByType.get(1)));
    setTextByNeedle('repairs', formatMoneyDecimal(autoByType.get(2)));
    setTextByNeedle('tags', formatMoneyDecimal(autoByType.get(3)));
    setTextByNeedle('insurance', formatMoneyDecimal(autoByType.get(4)));
    setTextByNeedle('payments', formatMoneyDecimal(autoByType.get(5)));
    setTextByNeedle('rental', formatMoneyDecimal(autoByType.get(6)));
    setTextByNeedle('alternative transportation', formatMoneyDecimal(autoByType.get(7)));
    setTextByNeedle('tolls', formatMoneyDecimal(autoByType.get(8)));
    setTextByNeedle('other automobile', formatMoneyDecimal(autoByType.get(9)));
    const totalAuto = sumAmounts(monthlyAutomobileExpenses);
    if (totalAuto > 0) setTextByNeedle('total automobile', formatMoneyDecimal(totalAuto));

    // Short form: children expenses (typeIds 1–23; map total and common lines if form has them)
    const childrenByType = sumByTypeId(monthlyChildrenExpenses);
    setTextByNeedle('day care', formatMoneyDecimal(childrenByType.get(1)));
    setTextByNeedle('tuition', formatMoneyDecimal(childrenByType.get(2)));
    setTextByNeedle('school supplies', formatMoneyDecimal(childrenByType.get(3)));
    setTextByNeedle('after school', formatMoneyDecimal(childrenByType.get(4)));
    setTextByNeedle('lunch money', formatMoneyDecimal(childrenByType.get(5)));
    setTextByNeedle('tutoring', formatMoneyDecimal(childrenByType.get(6)));
    setTextByNeedle('allowances', formatMoneyDecimal(childrenByType.get(7)));
    setTextByNeedle('clothing', formatMoneyDecimal(childrenByType.get(8)));
    setTextByNeedle('entertainment', formatMoneyDecimal(childrenByType.get(9)));
    setTextByNeedle('health insurance', formatMoneyDecimal(childrenByType.get(10)));
    setTextByNeedle('medical dental', formatMoneyDecimal(childrenByType.get(11)));
    setTextByNeedle('other children', formatMoneyDecimal(childrenByType.get(23)));
    const totalChildren = sumAmounts(monthlyChildrenExpenses);
    if (totalChildren > 0) setTextByNeedle('total children', formatMoneyDecimal(totalChildren));

    // Short form: children other (one "Other" type; sum amount, optional description from ifOther)
    const totalChildrenOther = sumAmounts(monthlyChildrenOtherExpenses);
    const childrenOtherRow = (monthlyChildrenOtherExpenses ?? [])[0];
    const childrenOtherDesc = childrenOtherRow ? String(childrenOtherRow?.ifOther ?? '').trim() : '';
    if (totalChildrenOther > 0) setTextByNeedle('children other', formatMoneyDecimal(totalChildrenOther));
    if (childrenOtherDesc) setTextByNeedle('other relationship', childrenOtherDesc);

    // Short form: creditors (one "Other" type; sum amount, creditor names from ifOther)
    const totalCreditors = sumAmounts(monthlyCreditorsExpenses);
    const creditorNames = (monthlyCreditorsExpenses ?? [])
      .slice(0, 5)
      .map((r: any) => String(r?.ifOther ?? '').trim())
      .filter(Boolean);
    if (totalCreditors > 0) setTextByNeedle('creditor', formatMoneyDecimal(totalCreditors));
    if (creditorNames.length > 0) setTextByNeedle('creditors', creditorNames.join('; '));

    // Short form: insurance expenses (typeId 1–4: health, life, dental, other)
    const insuranceByType = sumByTypeId(monthlyInsuranceExpenses);
    setTextByNeedle('health insurance', formatMoneyDecimal(insuranceByType.get(1)));
    setTextByNeedle('life insurance', formatMoneyDecimal(insuranceByType.get(2)));
    setTextByNeedle('dental insurance', formatMoneyDecimal(insuranceByType.get(3)));
    setTextByNeedle('other insurance', formatMoneyDecimal(insuranceByType.get(4)));
    const totalInsurance = sumAmounts(monthlyInsuranceExpenses);
    if (totalInsurance > 0) setTextByNeedle('total insurance', formatMoneyDecimal(totalInsurance));

    // Short form: other expenses (one "Other" type; sum amount, optional description from ifOther)
    const totalOther = sumAmounts(monthlyOtherExpenses);
    const otherExpenseRow = (monthlyOtherExpenses ?? [])[0];
    const otherExpenseDesc = otherExpenseRow ? String(otherExpenseRow?.ifOther ?? '').trim() : '';
    if (totalOther > 0) setTextByNeedle('other expense', formatMoneyDecimal(totalOther));
    if (otherExpenseDesc) setTextByNeedle('other expenses', otherExpenseDesc);

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

    // Short form: assets — left checkbox = Judge award? true; right checkboxes = non-marital (petitioner/respondent); total row left unchecked
    const assetFlags = sumAssetsByTypeIdWithFlags(assets);
    const af = (id: number) => assetFlags.get(id);
    const v = (id: number) => formatMoneyDecimal(af(id)?.value);
    const hasAsset = (val: string) => val !== '' && val !== '0.00';

    // cash on hand (type 1)
    setShortFormText('cash on hand current fair market value', v(1));
    if (hasAsset(v(1)) && af(1)?.judgeAward) setShortFormCheck('cash on hand check box', true);
    if (af(1)?.petitioner) setShortFormCheck('cash on hand petitioner check box', true);
    if (af(1)?.respondent) setShortFormCheck('cash on hand respondent check box', true);

    // cash in banks (type 2)
    setShortFormText('Cash in banks or credit unions current fair market value', v(2));
    if (hasAsset(v(2)) && af(2)?.judgeAward) setShortFormCheck('cash in banks check box', true);
    if (af(2)?.petitioner) setShortFormCheck('cash in banks petitioner check box', true);
    if (af(2)?.respondent) setShortFormCheck('cash in banks respondent check box', true);

    // stocks, bonds, notes (types 3,4,5)
    const sbVal = (af(3)?.value ?? 0) + (af(4)?.value ?? 0) + (af(5)?.value ?? 0);
    const sbJudge = af(3)?.judgeAward || af(4)?.judgeAward || af(5)?.judgeAward;
    const sbPet = af(3)?.petitioner || af(4)?.petitioner || af(5)?.petitioner;
    const sbResp = af(3)?.respondent || af(4)?.respondent || af(5)?.respondent;
    const stocksBondsVal = formatMoneyDecimal(sbVal);
    setShortFormText('Stocks Bonds Notes current fair market value', stocksBondsVal);
    if (hasAsset(stocksBondsVal) && sbJudge) setShortFormCheck('stocks, bonds, notes check box', true);
    if (sbPet) setShortFormCheck('stocks, bonds, notes petitioner check box', true);
    if (sbResp) setShortFormCheck('stocks, bonds, notes respondent check box', true);

    // real estate (type 6)
    setShortFormText('Real estate Home current fair market value', v(6));
    if (hasAsset(v(6)) && af(6)?.judgeAward) setShortFormCheck('real estate check box', true);
    if (af(6)?.petitioner) setShortFormCheck('real estate petitioner check box', true);
    if (af(6)?.respondent) setShortFormCheck('real estate respondent check box', true);

    // other real estate (type 7) — form has no left checkbox, only petitioner/respondent
    setShortFormText('Other real estate current fair market value', v(7));
    if (af(7)?.petitioner) setShortFormCheck('other real estate petitioner check box', true);
    if (af(7)?.respondent) setShortFormCheck('other real estate respondent check box', true);

    // automobiles (type 9)
    setShortFormText('Automobiles current fair market value', v(9));
    if (hasAsset(v(9)) && af(9)?.judgeAward) setShortFormCheck('automobiles check box', true);
    if (af(9)?.petitioner) setShortFormCheck('automobiles petitioner check box', true);
    if (af(9)?.respondent) setShortFormCheck('automobiles respondent check box', true);

    // other personal property (types 8,10,11,13,14,15,16,17,18)
    const oppIds = [8, 10, 11, 13, 14, 15, 16, 17, 18];
    let oppVal = 0;
    let oppJudge = false;
    let oppPet = false;
    let oppResp = false;
    for (const id of oppIds) {
      const f = af(id);
      if (f) {
        oppVal += f.value;
        if (f.judgeAward) oppJudge = true;
        if (f.petitioner) oppPet = true;
        if (f.respondent) oppResp = true;
      }
    }
    const otherPersonalVal = formatMoneyDecimal(oppVal);
    setShortFormText('Other personal property current fair market value', otherPersonalVal);
    if (hasAsset(otherPersonalVal) && oppJudge) setShortFormCheck('other personal property check box', true);
    if (oppPet) setShortFormCheck('other personal property petitioner check box', true);
    if (oppResp) setShortFormCheck('other personal property respondent check box', true);

    // retirement (type 12)
    setShortFormText('Retirement plans Profit Sharing Pension IRA 401ks etc current fair market value', v(12));
    if (hasAsset(v(12)) && af(12)?.judgeAward) setShortFormCheck('retirement plans check box', true);
    if (af(12)?.petitioner) setShortFormCheck('retirement plans petitioner check box', true);
    if (af(12)?.respondent) setShortFormCheck('retirement plans respondent check box', true);

    // other rows 1–6 (type 19)
    const otherAssetRows = (assets ?? []).filter((r: any) => Number(r?.assetsTypeId) === 19).slice(0, 6);
    for (let i = 0; i < otherAssetRows.length; i += 1) {
      const r = otherAssetRows[i] as any;
      const desc = String(r?.description ?? '').trim();
      const val = formatMoneyDecimal(r?.marketValue);
      const judgeAward = Boolean(r?.judgeAward);
      const petitioner = isPetitionerParty(r?.nonMaritalTypeId);
      const respondent = isRespondentParty(r?.nonMaritalTypeId);
      setShortFormText(`Other Row ${i + 1}`, desc, 'current fair market value');
      setShortFormText(`other row ${i + 1} current fair market value`, val);
      if (hasAsset(val) && judgeAward) setShortFormCheck(`other row ${i + 1} check box`, true);
      if (petitioner) setShortFormCheck(`other row ${i + 1} petitioner check box`, true);
      if (respondent) setShortFormCheck(`other row ${i + 1} respondent check box`, true);
    }

    // total assets — value only; leave all checkboxes unchecked
    const totalAssets = (assets ?? []).reduce((sum: number, r: any) => sum + (Number(r?.marketValue) || 0), 0);
    setShortFormText('total assets current fair market value', formatMoneyDecimal(totalAssets));

    // Short form: liabilities — left checkbox = User owes? true; right = petitioner/respondent; total row left unchecked
    const liabFlags = sumLiabilitiesByTypeIdWithFlags(liabilities);
    const lf = (id: number) => liabFlags.get(id);
    const w = (id: number) => formatMoneyDecimal(lf(id)?.value);
    const hasLiab = (val: string) => val !== '' && val !== '0.00';

    setShortFormText('mortgages on real estate current amount owed', w(1));
    if (hasLiab(w(1)) && lf(1)?.userOwes) setShortFormCheck('Mortgages on real estate check box', true);
    if (lf(1)?.petitioner) setShortFormCheck('mortgages on real estate petitioner check box', true);
    if (lf(1)?.respondent) setShortFormCheck('mortgages on real estate respondent check box', true);

    setShortFormText('Second mortgage on home current amount owed', w(2));
    if (hasLiab(w(2)) && lf(2)?.userOwes) setShortFormCheck('second mortgages check box', true);
    if (lf(2)?.petitioner) setShortFormCheck('second mortgage on home petitioner check box', true);
    if (lf(2)?.respondent) setShortFormCheck('second mortgage on home respondent check box', true);

    setShortFormText('Other mortgages current amount owed', w(3));
    if (hasLiab(w(3)) && lf(3)?.userOwes) setShortFormCheck('other mortgages check box', true);
    if (lf(3)?.petitioner) setShortFormCheck('other mortgages petitioner check box', true);
    if (lf(3)?.respondent) setShortFormCheck('other mortgages respondent check box', true);

    const autoLoanRow = (liabilities ?? []).find((r: any) => Number(r?.liabilitiesTypeId) === 5);
    const autoLoanDesc = autoLoanRow ? String(autoLoanRow?.description ?? '').trim() : '';
    setShortFormText('Auto loans Row 1', autoLoanDesc, 'current amount owed');
    setShortFormText('Auto loans Row 1 current amount owed', w(5));
    if (hasLiab(w(5)) && lf(5)?.userOwes) setShortFormCheck('auto loans check box', true);
    if (lf(5)?.petitioner) setShortFormCheck('auto loans row 1 petitioner check box', true);
    if (lf(5)?.respondent) setShortFormCheck('auto loans row 1 respondent check box', true);

    const creditCardRows = (liabilities ?? []).filter((r: any) => Number(r?.liabilitiesTypeId) === 4).slice(0, 3);
    for (let i = 0; i < creditCardRows.length; i += 1) {
      const r = creditCardRows[i] as any;
      const amt = formatMoneyDecimal(r?.amountOwed);
      const userOwes = Boolean(r?.userOwes);
      const petitioner = isPetitionerParty(r?.nonMaritalTypeId);
      const respondent = isRespondentParty(r?.nonMaritalTypeId);
      setShortFormText(`Charge credit card accounts row ${i + 1}`, String(r?.description ?? '').trim());
      setShortFormText(`Charge credit card accounts row ${i + 1} current amount owed`, amt);
      if (hasLiab(amt) && userOwes) setShortFormCheck(`charge credit card accounts row ${i + 1} check box`, true);
      if (petitioner) setShortFormCheck(`Charge credit card accounts row ${i + 1} petitioner check box`, true);
      if (respondent) setShortFormCheck(`Charge credit card accounts row ${i + 1} respondent check box`, true);
    }

    const otherLiabRows = (liabilities ?? []).filter((r: any) => Number(r?.liabilitiesTypeId) === 9).slice(0, 3);
    for (let i = 0; i < otherLiabRows.length; i += 1) {
      const r = otherLiabRows[i] as any;
      const desc = String(r?.description ?? '').trim();
      const amt = formatMoneyDecimal(r?.amountOwed);
      const userOwes = Boolean(r?.userOwes);
      const petitioner = isPetitionerParty(r?.nonMaritalTypeId);
      const respondent = isRespondentParty(r?.nonMaritalTypeId);
      setShortFormText(i === 0 ? 'Other Row 1 2' : i === 1 ? 'Other Row 2 2' : 'Other Row 3 2', desc);
      setShortFormText(`other row ${i + 1} current amount owed`, amt);
      if (hasLiab(amt) && userOwes) setShortFormCheck(`other row ${i + 1} 2 check box`, true);
      if (petitioner) setShortFormCheck(`Other row ${i + 1} petitioner check box 2`, true);
      if (respondent) setShortFormCheck(`Other row ${i + 1} respondent check box 2`, true);
    }

    // total debts — value only; leave all checkboxes unchecked
    const totalLiabilities = (liabilities ?? []).reduce((sum: number, r: any) => sum + (Number(r?.amountOwed) || 0), 0);
    setShortFormText('total debts current amount owed', formatMoneyDecimal(totalLiabilities));

    // Short form: contingent assets — left = Judge award? true; right = petitioner/respondent; total row left unchecked
    const contingentAssetRows = (contingentAssets ?? []).slice(0, 2);
    for (let i = 0; i < 2; i += 1) {
      const r = contingentAssetRows[i] as any;
      const desc = r ? String(r?.description ?? '').trim() : '';
      const val = r ? formatMoneyDecimal(r?.possibleValue) : '';
      const judgeAward = r ? Boolean(r?.judgeAward) : false;
      const petitioner = r ? isPetitionerParty(r?.nonMaritalTypeId) : false;
      const respondent = r ? isRespondentParty(r?.nonMaritalTypeId) : false;
      setShortFormText(`contingent assets row ${i + 1}`, desc);
      setShortFormText(`contingent assets row ${i + 1} possible value`, val);
      if ((val !== '' && val !== '0.00') && judgeAward) setShortFormCheck(`contingent assets row ${i + 1} check box`, true);
      if (petitioner) setShortFormCheck(`contingent assets row ${i + 1} petitioner check box`, true);
      if (respondent) setShortFormCheck(`contingent assets row ${i + 1} respondent check box`, true);
    }
    const totalContingentAssets = (contingentAssets ?? []).reduce((s: number, r: any) => s + (Number(r?.possibleValue) || 0), 0);
    if (totalContingentAssets > 0) {
      setShortFormText('total contingent assets possible value', formatMoneyDecimal(totalContingentAssets));
    }
    // total contingent assets row: no checkboxes checked

    // Short form: contingent liabilities — left = User owes? true; right = petitioner/respondent; total row left unchecked (form typo "liabilites")
    const contingentLiabRows = (contingentLiabilities ?? []).slice(0, 2);
    for (let i = 0; i < 2; i += 1) {
      const r = contingentLiabRows[i] as any;
      const desc = r ? String(r?.description ?? '').trim() : '';
      const amt = r ? formatMoneyDecimal(r?.possibleAmountOwed) : '';
      const userOwes = r ? Boolean(r?.userOwes) : false;
      const petitioner = r ? isPetitionerParty(r?.nonMaritalTypeId) : false;
      const respondent = r ? isRespondentParty(r?.nonMaritalTypeId) : false;
      setShortFormText(`contingent liabilities row ${i + 1}`, desc);
      setShortFormText(`contingent liabilities row ${i + 1} possible amount owed`, amt);
      if ((amt !== '' && amt !== '0.00') && userOwes) setShortFormCheck(`contingent liabilities row ${i + 1} check box`, true);
      if (petitioner) setShortFormCheck(`contingent liabilities row ${i + 1} petitioner check box`, true);
      if (respondent) setShortFormCheck(`contingent liabilities row ${i + 1} respondent check box`, true);
    }
    const totalContingentLiab = (contingentLiabilities ?? []).reduce((s: number, r: any) => s + (Number(r?.possibleAmountOwed) || 0), 0);
    if (totalContingentLiab > 0) {
      setShortFormText('total contingent liabilites possible amount owed', formatMoneyDecimal(totalContingentLiab));
    }
    // total contingent liabilities row: no checkboxes checked

    const today = new Date().toLocaleDateString();
    setTextByNeedle('date', today);
    setTextByNeedle('dated', today);

    // Other party or his/her attorney: Name, Address, City State Zip, Telephone, Fax, E-mail (respondent attorney if present, else respondent)
    if (otherPartyUser) {
      const otherName = userDisplayName(otherPartyUser);
      const addr1 = [String(otherPartyUser?.addressLine1 ?? '').trim(), String(otherPartyUser?.addressLine2 ?? '').trim()].filter(Boolean).join(', ');
      const cityStateZip = [otherPartyUser?.city, otherPartyUser?.state, otherPartyUser?.zipCode].filter(Boolean).join(', ');
      if (otherName) setTextIfExists(form, 'name', otherName);
      if (addr1) setTextIfExists(form, 'address 1', addr1);
      if (cityStateZip) setTextIfExists(form, 'city, state, zip', cityStateZip);
      if (otherPartyUser?.phone) setTextIfExists(form, 'telephone no', String(otherPartyUser.phone).trim());
      // User model has no fax; leave "fax number" blank if not present
      if (otherPartyUser?.email) setTextIfExists(form, 'email address', String(otherPartyUser.email).trim());
    }

    // Petitioner block (Printed Name, Address, City State Zip, Telephone Number, Fax Number, E-mail Address(es))
    if (petitionerContactUser) {
      const printedName = userDisplayName(petitionerContactUser);
      const addr2 = [String(petitionerContactUser?.addressLine1 ?? '').trim(), String(petitionerContactUser?.addressLine2 ?? '').trim()].filter(Boolean).join(', ');
      const cityStateZip2 = [petitionerContactUser?.city, petitionerContactUser?.state, petitionerContactUser?.zipCode].filter(Boolean).join(', ');
      if (printedName) setTextIfExists(form, 'Printed Name', printedName);
      if (addr2) setTextIfExists(form, 'address 2', addr2);
      if (cityStateZip2) setTextIfExists(form, 'City State Zip', cityStateZip2);
      if (petitionerContactUser?.phone) setTextIfExists(form, 'Telephone Number', String(petitionerContactUser.phone).trim());
      // User model has no fax; leave "Fax no" blank if not present
      if (petitionerContactUser?.email) setTextIfExists(form, 'Email Addresses', String(petitionerContactUser.email).trim());
    }

    // Child Support Guidelines Worksheet: exactly one checkbox from case.childSupportWorksheetFiled
    const csgFiled = caseDoc?.childSupportWorksheetFiled;
    setShortFormCheck('a child support guidelines worksheet is or will be filed in this case check box', csgFiled === true);
    setShortFormCheck('a child support guidelines worksheet is not being filed in this case check box', csgFiled === false);
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

  // Update appearances so set values are visible before we strip or flatten
  try {
    form.updateFieldAppearances();
  } catch {
    // Non-fatal; save() will try again
  }

  stripLeadingInstructionPages(pdf, 3);

  // Flatten long form only; short form keeps fillable fields so set values display (like debug script)
  if (formKey !== 'short') {
    try {
      form.flatten();
    } catch {
      // Non-fatal
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
