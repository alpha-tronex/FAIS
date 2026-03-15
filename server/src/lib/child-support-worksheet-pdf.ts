import mongoose from 'mongoose';
import { CaseModel, User } from '../models.js';
import { loadTemplatePdf, setTextIfExists, checkIfExists, formatMoneyDecimal } from './affidavit-pdf.js';
import { userDisplayName, caseIncludesUser } from './affidavit-helpers.js';
import { userScopedFilter, listAffidavitRows } from './affidavit-store.js';
import { computeAffidavitSummary } from './affidavit-summary.js';
import { getWorksheet } from './child-support-worksheet-store.js';
import type { AuthPayload } from '../routes/middleware.js';
import type { WorksheetData } from './child-support-worksheet-store.js';

export type FillChildSupportWorksheetParams = {
  targetUserObjectId: string;
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
  } else {
    const participantFilter = {
      $or: [
        { petitionerId: new mongoose.Types.ObjectId(targetUserObjectId) },
        { respondentId: new mongoose.Types.ObjectId(targetUserObjectId) }
      ]
    };
    caseDoc = await CaseModel.findOne(participantFilter)
      .sort({ createdAt: -1, _id: -1 })
      .populate('petitionerId', 'uname firstName lastName')
      .populate('respondentId', 'uname firstName lastName')
      .lean<any>();
  }

  const [worksheetDoc, affidavitSummary, monthlyIncome] = await Promise.all([
    getWorksheet(targetUserObjectId, requestedCaseId ?? null),
    computeAffidavitSummary(targetUserObjectId),
    listAffidavitRows('monthlyincome', userScopedFilter(targetUserObjectId))
  ]);

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
  const monthlyGrossFromAffidavit = sumAmounts(monthlyIncome);
  const petitionerId = caseDoc?.petitionerId?._id?.toString?.() ?? (caseDoc?.petitionerId as any)?.toString?.();
  const isTargetPetitioner = petitionerId === targetUserObjectId;
  const parentAMonthlyIncome = data.parentAMonthlyGrossIncome ?? (isTargetPetitioner ? monthlyGrossFromAffidavit : 0);
  const parentBMonthlyIncome = data.parentBMonthlyGrossIncome ?? (isTargetPetitioner ? 0 : monthlyGrossFromAffidavit);

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
  if (data.parentAMonthlyGrossIncome != null && Number.isFinite(data.parentAMonthlyGrossIncome)) {
    setTextByNeedle('parent a', formatMoneyDecimal(data.parentAMonthlyGrossIncome));
    setTextByNeedle('parent a income', formatMoneyDecimal(data.parentAMonthlyGrossIncome));
    setAllByNeedle('gross monthly', formatMoneyDecimal(data.parentAMonthlyGrossIncome));
  } else if (parentAMonthlyIncome > 0) {
    setTextByNeedle('parent a', formatMoneyDecimal(parentAMonthlyIncome));
    setTextByNeedle('parent a income', formatMoneyDecimal(parentAMonthlyIncome));
  }
  if (data.parentBMonthlyGrossIncome != null && Number.isFinite(data.parentBMonthlyGrossIncome)) {
    setTextByNeedle('parent b', formatMoneyDecimal(data.parentBMonthlyGrossIncome));
    setTextByNeedle('parent b income', formatMoneyDecimal(data.parentBMonthlyGrossIncome));
  } else if (parentBMonthlyIncome > 0) {
    setTextByNeedle('parent b', formatMoneyDecimal(parentBMonthlyIncome));
    setTextByNeedle('parent b income', formatMoneyDecimal(parentBMonthlyIncome));
  }
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

  setTextByNeedle('date', new Date().toLocaleDateString('en-US'));

  try {
    form.flatten();
  } catch {
    // Some forms may not support flatten
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
