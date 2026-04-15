import mongoose from 'mongoose';
import { CaseModel } from '../models.js';
import { listAffidavitRows, userScopedFilter } from './affidavit-store.js';
import type { WorksheetData } from './child-support-worksheet-store.js';

function sumAmounts(rows: any[] | null | undefined): number {
  if (!rows || rows.length === 0) return 0;
  return rows.reduce((acc, r) => {
    const amt = Number(r?.amount ?? 0);
    return acc + (Number.isFinite(amt) ? amt : 0);
  }, 0);
}

/**
 * Net monthly income for respondent (Line 1) from worksheet overrides, with legacy fallback:
 * explicit net → stored gross column → affidavit-derived net.
 */
export function worksheetParentBNetMonthlyForGuidelines(data: WorksheetData, affidavitNetB: number): number {
  const netField = data.parentBMonthlyNetIncome;
  if (netField != null && Number.isFinite(Number(netField))) {
    return Math.max(0, Number(netField));
  }
  const grossField = data.parentBMonthlyGrossIncome;
  if (grossField != null && Number.isFinite(Number(grossField))) {
    return Math.max(0, Number(grossField));
  }
  return Math.max(0, Number(affidavitNetB) || 0);
}

async function computeNetMonthlyIncomeForUser(userObjectId: string): Promise<number> {
  const [incomeRows, deductionRows] = await Promise.all([
    listAffidavitRows('monthlyincome', userScopedFilter(userObjectId)),
    listAffidavitRows('monthlydeductions', userScopedFilter(userObjectId))
  ]);
  const net = sumAmounts(incomeRows) - sumAmounts(deductionRows);
  return Math.max(0, net);
}

export async function resolveParentNetMonthlyIncomes(
  targetUserObjectId: string,
  caseId?: string
): Promise<{
  caseDoc: any | null;
  parentANetMonthlyIncome: number;
  parentBNetMonthlyIncome: number;
  isTargetPetitioner: boolean;
}> {
  let caseDoc: any | null = null;
  if (caseId && mongoose.isValidObjectId(caseId)) {
    caseDoc = await CaseModel.findById(caseId)
      .populate('petitionerId', 'uname firstName lastName')
      .populate('respondentId', 'uname firstName lastName')
      .lean<any>();
  } else {
    caseDoc = await CaseModel.findOne({
      $or: [
        { petitionerId: new mongoose.Types.ObjectId(targetUserObjectId) },
        { respondentId: new mongoose.Types.ObjectId(targetUserObjectId) }
      ]
    })
      .sort({ createdAt: -1, _id: -1 })
      .populate('petitionerId', 'uname firstName lastName')
      .populate('respondentId', 'uname firstName lastName')
      .lean<any>();
  }

  const petitionerId = caseDoc?.petitionerId?._id?.toString?.() ?? (caseDoc?.petitionerId as any)?.toString?.();
  const respondentId = caseDoc?.respondentId?._id?.toString?.() ?? (caseDoc?.respondentId as any)?.toString?.();
  const isTargetPetitioner = petitionerId === targetUserObjectId;

  if (!petitionerId || !respondentId) {
    const net = await computeNetMonthlyIncomeForUser(targetUserObjectId);
    return {
      caseDoc,
      parentANetMonthlyIncome: isTargetPetitioner ? net : 0,
      parentBNetMonthlyIncome: isTargetPetitioner ? 0 : net,
      isTargetPetitioner
    };
  }

  const [petitionerNet, respondentNet] = await Promise.all([
    computeNetMonthlyIncomeForUser(petitionerId),
    computeNetMonthlyIncomeForUser(respondentId)
  ]);
  return {
    caseDoc,
    parentANetMonthlyIncome: petitionerNet,
    parentBNetMonthlyIncome: respondentNet,
    isTargetPetitioner
  };
}
