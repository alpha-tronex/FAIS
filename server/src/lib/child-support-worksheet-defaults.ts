import mongoose from 'mongoose';
import { CaseModel } from '../models.js';
import { sumGrossMonthlyIncomeFromAffidavitRows } from './affidavit-summary.js';
import type { WorksheetData } from './child-support-worksheet-store.js';

/**
 * Defaults for worksheet fields sourced from the case (numChildren) and each party’s
 * affidavit monthly income totals. Parent A = petitioner, Parent B = respondent.
 */
export async function buildWorksheetDefaultsFromCaseAndAffidavits(caseId: string): Promise<Partial<WorksheetData>> {
  const out: Partial<WorksheetData> = {};
  if (!mongoose.isValidObjectId(caseId)) return out;

  const caseDoc = await CaseModel.findById(caseId)
    .select({ numChildren: 1, petitionerId: 1, respondentId: 1 })
    .lean<{
      numChildren?: number;
      petitionerId?: mongoose.Types.ObjectId;
      respondentId?: mongoose.Types.ObjectId;
    } | null>();

  if (!caseDoc) return out;

  if (caseDoc.numChildren != null && Number.isFinite(Number(caseDoc.numChildren))) {
    const n = Math.floor(Number(caseDoc.numChildren));
    if (n >= 0 && n <= 99) out.numberOfChildren = n;
  }

  const pId = caseDoc.petitionerId?.toString();
  const rId = caseDoc.respondentId?.toString();
  if (pId) {
    const g = await sumGrossMonthlyIncomeFromAffidavitRows(pId);
    if (g > 0) out.parentAMonthlyGrossIncome = g;
  }
  if (rId) {
    const g = await sumGrossMonthlyIncomeFromAffidavitRows(rId);
    if (g > 0) out.parentBMonthlyGrossIncome = g;
  }

  return out;
}

/**
 * Merge stored worksheet with defaults from case + affidavits.
 * - `numberOfChildren`: case `numChildren` wins whenever the case provides it (same source as Cases page).
 * - Income fields: only fill when still missing on the saved worksheet (user/affidavit overrides kept).
 */
export function mergeStoredWorksheetWithDefaults(stored: WorksheetData, defaults: Partial<WorksheetData>): WorksheetData {
  const merged: WorksheetData = { ...stored };

  if (defaults.numberOfChildren !== undefined) {
    merged.numberOfChildren = defaults.numberOfChildren;
  }

  const incomeKeys: (keyof WorksheetData)[] = ['parentAMonthlyGrossIncome', 'parentBMonthlyGrossIncome'];
  for (const key of incomeKeys) {
    if (defaults[key] === undefined) continue;
    const cur = merged[key];
    if (cur === undefined || cur === null) {
      (merged as Record<string, unknown>)[key as string] = defaults[key];
    }
  }
  return merged;
}
