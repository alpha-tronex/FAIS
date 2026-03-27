import mongoose from 'mongoose';
import { CaseModel, User } from '../models.js';
import { loadTemplatePdf, setTextIfExists, checkIfExists, formatMoneyDecimal } from './affidavit-pdf.js';
import { userDisplayName, caseIncludesUser } from './affidavit-helpers.js';
import { getWorksheet } from './child-support-worksheet-store.js';
import { resolveParentNetMonthlyIncomes } from './child-support-worksheet-values.js';
import { computeChildSupport } from './child-support-calculator.js';
import { setTextByWidgetIndex } from './pdf-multi-widget.js';
import type { AuthPayload } from '../routes/middleware.js';
import type { WorksheetData } from './child-support-worksheet-store.js';

export type FillChildSupportWorksheetParams = {
  targetUserObjectId: string;
  caseId?: string;
  auth: AuthPayload;
};

export async function fillChildSupportWorksheetPdf(params: FillChildSupportWorksheetParams): Promise<Buffer> {
  const { targetUserObjectId, caseId: requestedCaseId } = params;

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
    if (params.auth.roleTypeId !== 5) {
      const participantIds = [
        caseDoc.petitionerId?._id?.toString?.() ?? (caseDoc.petitionerId as any)?.toString?.(),
        caseDoc.respondentId?._id?.toString?.() ?? (caseDoc.respondentId as any)?.toString?.()
      ].filter(Boolean);
      if (!participantIds.includes(params.auth.sub)) {
        throw Object.assign(new Error('Forbidden'), { status: 403 });
      }
    }
  }

  const [worksheetDoc, netIncomeContext] = await Promise.all([
    getWorksheet(targetUserObjectId, requestedCaseId ?? null),
    resolveParentNetMonthlyIncomes(targetUserObjectId, requestedCaseId)
  ]);
  if (!caseDoc && netIncomeContext.caseDoc) caseDoc = netIncomeContext.caseDoc;

  const pdf = await loadTemplatePdf('child-support-worksheet');
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

  /** Set text on all matching fields (same name can appear on multiple pages) */
  function setAllByNeedle(needle: string, value: string) {
    const n = String(needle ?? '').trim().toLowerCase();
    if (!n) return;
    const matches = allFormFields.filter(
      (x) => x.name.toLowerCase().includes(n) && typeof (x.field as any).setText === 'function'
    );
    for (const entry of matches) {
      (entry.field as any).setText(value);
    }
  }

  const data: WorksheetData = worksheetDoc?.data ?? {};
  const parentANetMonthlyIncome = data.parentAMonthlyGrossIncome ?? netIncomeContext.parentANetMonthlyIncome;
  const parentBNetMonthlyIncome = data.parentBMonthlyGrossIncome ?? netIncomeContext.parentBNetMonthlyIncome;
  const calc = await computeChildSupport({
    numberOfChildren: Number(data.numberOfChildren ?? 1),
    parentANetMonthlyIncome,
    parentBNetMonthlyIncome,
    overnightsParentA: Number(data.overnightsParentA ?? 0),
    overnightsParentB: Number(data.overnightsParentB ?? 0),
    healthInsuranceMonthly: Number(data.healthInsuranceMonthly ?? 0),
    daycareMonthly: Number(data.daycareMonthly ?? 0),
    otherChildCareMonthly: Number(data.otherChildCareMonthly ?? 0)
  });

  if (caseDoc) {
    const petitionerName = userDisplayName(caseDoc.petitionerId);
    const respondentName = userDisplayName(caseDoc.respondentId);
    if (caseDoc.caseNumber) setTextByNeedle('case', String(caseDoc.caseNumber).trim());
    if (caseDoc.division) setTextByNeedle('division', String(caseDoc.division).trim());
    if (petitionerName) setTextByNeedle('petitioner', petitionerName);
    if (respondentName) setTextByNeedle('respondent', respondentName);
  }

  if (data.numberOfChildren != null && Number.isFinite(data.numberOfChildren)) {
    setTextByNeedle('number of children', String(data.numberOfChildren));
    setAllByNeedle('children', String(data.numberOfChildren));
  }
  if (parentANetMonthlyIncome > 0) setTextByNeedle('parent a income', formatMoneyDecimal(parentANetMonthlyIncome));
  if (parentBNetMonthlyIncome > 0) setTextByNeedle('parent b income', formatMoneyDecimal(parentBNetMonthlyIncome));
  if (data.overnightsParentA != null && Number.isFinite(data.overnightsParentA)) {
    setTextByNeedle('overnight', String(data.overnightsParentA));
    setTextByNeedle('parent a overnight', String(data.overnightsParentA));
  }
  if (data.overnightsParentB != null && Number.isFinite(data.overnightsParentB)) {
    setTextByNeedle('parent b overnight', String(data.overnightsParentB));
  }
  if (data.timesharingPercentageParentA != null && Number.isFinite(data.timesharingPercentageParentA)) {
    setTextByNeedle('timesharing', String(data.timesharingPercentageParentA));
  }
  if (data.timesharingPercentageParentB != null && Number.isFinite(data.timesharingPercentageParentB)) {
    setTextByNeedle('timesharing', String(data.timesharingPercentageParentB));
  }
  if (data.healthInsuranceMonthly != null && Number.isFinite(data.healthInsuranceMonthly)) {
    setTextByNeedle('health insurance', formatMoneyDecimal(data.healthInsuranceMonthly));
  }
  if (data.daycareMonthly != null && Number.isFinite(data.daycareMonthly)) {
    setTextByNeedle('daycare', formatMoneyDecimal(data.daycareMonthly));
  }
  if (data.otherChildCareMonthly != null && Number.isFinite(data.otherChildCareMonthly)) {
    setTextByNeedle('other child care', formatMoneyDecimal(data.otherChildCareMonthly));
  }
  if (data.mandatoryUnionDues != null && Number.isFinite(data.mandatoryUnionDues)) {
    setTextByNeedle('union', formatMoneyDecimal(data.mandatoryUnionDues));
  }
  if (data.supportPaidForOtherChildren != null && Number.isFinite(data.supportPaidForOtherChildren)) {
    setTextByNeedle('support other', formatMoneyDecimal(data.supportPaidForOtherChildren));
  }

  const { StandardFonts } = await import('pdf-lib');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  setTextByWidgetIndex(form as any, 'Present Net Monthly Income', [
    formatMoneyDecimal(calc.line1ParentA),
    formatMoneyDecimal(calc.line1ParentB)
  ], font);
  setTextByWidgetIndex(form as any, 'Basic Monthly Obligation', [
    formatMoneyDecimal(calc.line2BasicMonthlyObligation),
    formatMoneyDecimal(calc.line2BasicMonthlyObligation)
  ], font);

  setTextIfExists(form as any, 'Total Present Net Monthly Income', formatMoneyDecimal(calc.line1Total));
  setTextIfExists(form as any, 'Total Basic Monthly Obligation', formatMoneyDecimal(calc.line2BasicMonthlyObligation));
  setTextIfExists(form as any, 'Total Percent of Financial Responsibility', '100');
  setTextIfExists(form as any, 'Total Share of Basic Monthly Obligation', formatMoneyDecimal(calc.line4ShareA + calc.line4ShareB));
  setTextIfExists(form as any, 'Petitioner Monthly Obligation', formatMoneyDecimal(calc.line9MinimumObligationA));
  setTextIfExists(form as any, 'Respondent Monthly Obligation', formatMoneyDecimal(calc.line9MinimumObligationB));
  setTextIfExists(form as any, 'Total Monthly Obligation', formatMoneyDecimal(calc.line9MinimumObligationA + calc.line9MinimumObligationB));
  setTextIfExists(form as any, 'Petitioner Percentage of Overnight Stays', formatMoneyDecimal(calc.line12PctOvernightsA));
  setTextIfExists(form as any, 'Respondent Percentage of Overnight Stays', formatMoneyDecimal(calc.line12PctOvernightsB));
  setTextIfExists(form as any, 'Total Percentage of Overnight Stays', formatMoneyDecimal(calc.line12PctOvernightsA + calc.line12PctOvernightsB));
  setTextIfExists(form as any, 'Petitioner Support Multiplied by other Parent percentage of overnights', formatMoneyDecimal(calc.line13SupportAByOtherPct));
  setTextIfExists(form as any, 'Respondenet Support Multiplied by other Parent percentage of overnights', formatMoneyDecimal(calc.line13SupportBByOtherPct));
  setTextIfExists(form as any, 'Total Support Multiplied by other Parent percentage of overnights', formatMoneyDecimal(calc.line13SupportAByOtherPct + calc.line13SupportBByOtherPct));
  setTextIfExists(form as any, '19 Total Child Support Owed from Petitioner to Respondent Add line 13A plus 18A', formatMoneyDecimal(calc.line19OwedPetitionerToRespondent));
  setTextIfExists(form as any, '20 Total Child Support Owed from Respondent to Petitioner Add line 13B plus line 18B', formatMoneyDecimal(calc.line20OwedRespondentToPetitioner));
  setTextIfExists(form as any, '21. Presumptive Child Support to be Paid', formatMoneyDecimal(calc.line21PresumptiveAmount));

  setTextByNeedle('date', new Date().toLocaleDateString('en-US'));

  try {
    form.flatten();
  } catch {
    // Some forms may not support flatten
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
