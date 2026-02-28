import mongoose from 'mongoose';
import { CaseModel, User } from '../models.js';
import { computeAffidavitSummary } from './affidavit-summary.js';
import type { AuthPayload } from '../routes/middleware.js';

export type ReportCriteria = {
  roleType: 'respondent' | 'petitioner';
  incomeMin?: number | null;
  incomeMax?: number | null;
  numChildrenMin?: number | null;
  numChildrenMax?: number | null;
};

export type ReportRow = {
  caseId: string;
  caseNumber: string;
  partyRole: 'respondent' | 'petitioner';
  partyName: string;
  grossAnnualIncome: number;
  under50K: boolean;
  numChildren?: number;
};

/**
 * Load cases the requester may see: Petitioner Attorney (3) sees cases where they are petitionerAttId;
 * Admin (5) sees all cases, optionally filtered by userId query.
 */
async function getCasesForReport(
  auth: AuthPayload,
  filterUserId?: string | null
): Promise<{ _id: mongoose.Types.ObjectId; caseNumber: string; petitionerId?: mongoose.Types.ObjectId; respondentId?: mongoose.Types.ObjectId; numChildren?: number }[]> {
  const filter: Record<string, unknown> = {};
  if (auth.roleTypeId === 3) {
    filter.petitionerAttId = new mongoose.Types.ObjectId(auth.sub);
  } else if (auth.roleTypeId === 5 && filterUserId && mongoose.isValidObjectId(filterUserId)) {
    filter.$or = [
      { petitionerAttId: new mongoose.Types.ObjectId(filterUserId) },
      { respondentId: new mongoose.Types.ObjectId(filterUserId) },
      { petitionerId: new mongoose.Types.ObjectId(filterUserId) },
      { respondentAttId: new mongoose.Types.ObjectId(filterUserId) },
      { legalAssistantId: new mongoose.Types.ObjectId(filterUserId) },
    ];
  }
  const cases = await CaseModel.find(filter)
    .select({ _id: 1, caseNumber: 1, petitionerId: 1, respondentId: 1, numChildren: 1 })
    .lean();
  return cases as { _id: mongoose.Types.ObjectId; caseNumber: string; petitionerId?: mongoose.Types.ObjectId; respondentId?: mongoose.Types.ObjectId; numChildren?: number }[];
}

function getPartyId(caseDoc: { petitionerId?: mongoose.Types.ObjectId; respondentId?: mongoose.Types.ObjectId }, roleType: 'respondent' | 'petitioner'): string | null {
  const id = roleType === 'respondent' ? caseDoc.respondentId : caseDoc.petitionerId;
  return id ? id.toString() : null;
}

function displayName(doc: { firstName?: string; lastName?: string; uname?: string } | null): string {
  if (!doc) return '—';
  const first = (doc.firstName ?? '').trim();
  const last = (doc.lastName ?? '').trim();
  if (last || first) return [last, first].filter(Boolean).join(', ');
  return (doc.uname ?? '').trim() || '—';
}

const INCOME_MAX_CLAMP = 10_000_000;
const INCOME_MIN_CLAMP = 0;

function clampIncome(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const v = Math.max(INCOME_MIN_CLAMP, Math.min(INCOME_MAX_CLAMP, n));
  return v;
}

export async function runReport(
  auth: AuthPayload,
  criteria: ReportCriteria,
  options?: { filterUserId?: string | null }
): Promise<ReportRow[]> {
  const incomeMin = clampIncome(criteria.incomeMin);
  const incomeMax = clampIncome(criteria.incomeMax);
  const numChildrenMin = criteria.numChildrenMin != null && Number.isFinite(criteria.numChildrenMin) ? Math.max(0, criteria.numChildrenMin) : null;
  const numChildrenMax = criteria.numChildrenMax != null && Number.isFinite(criteria.numChildrenMax) ? Math.max(0, criteria.numChildrenMax) : null;

  const cases = await getCasesForReport(auth, options?.filterUserId ?? null);
  const rows: ReportRow[] = [];
  const filterUserId = options?.filterUserId ?? null;

  for (const c of cases) {
    // When filtering by a specific user ("about user X"), show rows where that user is the party (respondent or petitioner).
    let partyId: string | null;
    let partyRole: 'respondent' | 'petitioner';
    if (filterUserId && mongoose.isValidObjectId(filterUserId)) {
      const respId = c.respondentId?.toString();
      const petId = c.petitionerId?.toString();
      if (respId === filterUserId) {
        partyId = respId;
        partyRole = 'respondent';
      } else if (petId === filterUserId) {
        partyId = petId;
        partyRole = 'petitioner';
      } else {
        continue;
      }
    } else {
      partyRole = criteria.roleType;
      partyId = getPartyId(c, criteria.roleType);
    }
    if (!partyId) continue;

    if (numChildrenMin != null && (c.numChildren ?? 0) < numChildrenMin) continue;
    if (numChildrenMax != null && (c.numChildren ?? 0) > numChildrenMax) continue;

    let summary: Awaited<ReturnType<typeof computeAffidavitSummary>>;
    try {
      summary = await computeAffidavitSummary(partyId);
    } catch {
      continue;
    }

    const grossAnnualIncome = summary.grossAnnualIncome;
    if (incomeMin != null && grossAnnualIncome < incomeMin) continue;
    if (incomeMax != null && grossAnnualIncome > incomeMax) continue;

    const userDoc = await User.findById(partyId).select({ firstName: 1, lastName: 1, uname: 1 }).lean() as { firstName?: string; lastName?: string; uname?: string } | null;
    rows.push({
      caseId: c._id.toString(),
      caseNumber: c.caseNumber ?? '',
      partyRole,
      partyName: displayName(userDoc),
      grossAnnualIncome,
      under50K: grossAnnualIncome < 50000,
      numChildren: c.numChildren,
    });
  }

  return rows;
}
