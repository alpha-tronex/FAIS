import mongoose from 'mongoose';
import { AppointmentModel, CaseModel, User } from '../models.js';
import { computeAffidavitSummary } from './affidavit-summary.js';
import { listEmploymentRowsForUser } from './affidavit-store.js';
import type { AuthPayload } from '../routes/middleware.js';

export type ReportCriteria = {
  roleType: 'respondent' | 'petitioner';
  incomeMin?: number | null;
  incomeMax?: number | null;
  numChildrenMin?: number | null;
  numChildrenMax?: number | null;
  /** When set, only include cases in this county (case.countyId). */
  countyId?: number | null;
};

export type ReportRow = {
  caseId: string;
  caseNumber: string;
  partyRole: 'respondent' | 'petitioner';
  partyName: string;
  grossAnnualIncome: number;
  under50K: boolean;
  numChildren?: number;
  /** County name for the case (from lookup_counties via case.countyId). */
  countyName?: string | null;
};

/**
 * Load cases the requester may see: Petitioner Attorney (3) sees cases where they are petitionerAttId;
 * Legal Assistant (6) sees cases where they are legalAssistantId; Admin (5) sees all cases, optionally filtered by userId query.
 */
type CaseForReport = {
  _id: mongoose.Types.ObjectId;
  caseNumber: string;
  petitionerId?: mongoose.Types.ObjectId;
  respondentId?: mongoose.Types.ObjectId;
  numChildren?: number;
  countyId?: number;
};

async function getCasesForReport(
  auth: AuthPayload,
  filterUserId?: string | null,
  countyId?: number | null
): Promise<CaseForReport[]> {
  const filter: Record<string, unknown> = {};
  if (auth.roleTypeId === 3) {
    filter.petitionerAttId = new mongoose.Types.ObjectId(auth.sub);
  } else if (auth.roleTypeId === 6) {
    filter.legalAssistantId = new mongoose.Types.ObjectId(auth.sub);
  } else if (auth.roleTypeId === 5 && filterUserId && mongoose.isValidObjectId(filterUserId)) {
    filter.$or = [
      { petitionerAttId: new mongoose.Types.ObjectId(filterUserId) },
      { respondentId: new mongoose.Types.ObjectId(filterUserId) },
      { petitionerId: new mongoose.Types.ObjectId(filterUserId) },
      { respondentAttId: new mongoose.Types.ObjectId(filterUserId) },
      { legalAssistantId: new mongoose.Types.ObjectId(filterUserId) },
    ];
  }
  if (countyId != null && Number.isFinite(countyId)) {
    filter.countyId = countyId;
  }
  const cases = await CaseModel.find(filter)
    .select({ _id: 1, caseNumber: 1, petitionerId: 1, respondentId: 1, numChildren: 1, countyId: 1 })
    .lean();
  return cases as CaseForReport[];
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

/** Build a map of county id -> name from lookup_counties. */
async function getCountyNameMap(): Promise<Map<number, string>> {
  const rows = await mongoose.connection
    .collection('lookup_counties')
    .find({})
    .project({ id: 1, name: 1 })
    .toArray();
  const map = new Map<number, string>();
  for (const r of rows as { id?: unknown; name?: string }[]) {
    const id = typeof r?.id === 'number' && Number.isFinite(r.id) ? r.id : Number(r?.id);
    if (Number.isFinite(id) && id > 0 && typeof r?.name === 'string') {
      map.set(id, String(r.name).trim());
    }
  }
  return map;
}

type CaseForUser = CaseForReport & { petitionerAttId?: mongoose.Types.ObjectId };

/** Cases where userId is a party (petitioner or respondent) and the requester is allowed to see them. */
async function getCasesForUser(auth: AuthPayload, userId: string): Promise<CaseForUser[]> {
  const userObjId = mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : null;
  if (!userObjId) return [];
  const partyFilter = { $or: [{ petitionerId: userObjId }, { respondentId: userObjId }] };
  const filter: Record<string, unknown> =
    auth.roleTypeId === 3
      ? { $and: [{ petitionerAttId: new mongoose.Types.ObjectId(auth.sub) }, partyFilter] }
      : auth.roleTypeId === 6
        ? { $and: [{ legalAssistantId: new mongoose.Types.ObjectId(auth.sub) }, partyFilter] }
        : partyFilter;
  const cases = await CaseModel.find(filter)
    .select({ _id: 1, caseNumber: 1, petitionerId: 1, respondentId: 1, numChildren: 1, countyId: 1, petitionerAttId: 1, legalAssistantId: 1 })
    .lean();
  return cases as CaseForUser[];
}

export type AboutUserSummary = { bullets: string[] };

/**
 * Build a bullet-list summary for "Tell me about respondent/petitioner X".
 * Returns bullets: full name, petitioner attorney, county, employment, income, children, next appointment.
 */
export async function getAboutUserSummary(auth: AuthPayload, userId: string): Promise<AboutUserSummary | null> {
  const [userDoc, cases, countyNameById] = await Promise.all([
    User.findById(userId).select({ firstName: 1, lastName: 1, uname: 1 }).lean(),
    getCasesForUser(auth, userId),
    getCountyNameMap(),
  ]);
  if (!userDoc || cases.length === 0) return null;

  const bullets: string[] = [];
  const first = (userDoc as { firstName?: string; lastName?: string; uname?: string }).firstName ?? '';
  const last = (userDoc as { lastName?: string }).lastName ?? '';
  const uname = (userDoc as { uname?: string }).uname ?? '';
  const fullName = [last, first].filter(Boolean).join(', ') || uname || '—';
  bullets.push(`**Full name:** ${fullName}`);

  const firstCase = cases[0];
  const petitionerAttId = firstCase.petitionerAttId?.toString();
  if (petitionerAttId) {
    const att = await User.findById(petitionerAttId).select({ firstName: 1, lastName: 1 }).lean();
    const attName = att ? displayName(att as { firstName?: string; lastName?: string; uname?: string }) : '—';
    bullets.push(`**Petitioner attorney assigned to case:** ${attName}`);
  } else {
    bullets.push(`**Petitioner attorney assigned to case:** Not assigned`);
  }

  const countyId = firstCase.countyId;
  const countyName =
    countyId != null && Number.isFinite(countyId) ? countyNameById.get(countyId) ?? null : null;
  bullets.push(`**Residential county (case county):** ${countyName ?? 'Not specified'}`);

  const employmentRows = await listEmploymentRowsForUser(userId);
  const employed = employmentRows.length > 0;
  const firstJob = employed ? employmentRows[0] : null;
  const employerName = firstJob?.name ? String(firstJob.name).trim() : null;
  const occupation = firstJob?.occupation ? String(firstJob.occupation).trim() : null;
  const employmentStatus = employed
    ? `Employed${occupation ? ` as ${occupation}` : ''}${employerName ? ` at ${employerName}` : ''}`
    : 'Unemployed';
  bullets.push(`**Employment status, occupation and employer:** ${employmentStatus}`);

  let income = 'Not available';
  try {
    const summary = await computeAffidavitSummary(userId);
    income = `$${Number(summary.grossAnnualIncome).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (gross annual)`;
  } catch {
    // leave default
  }
  bullets.push(`**Income:** ${income}`);

  const numChildren = firstCase.numChildren ?? 'Not specified';
  bullets.push(`**Number of children:** ${numChildren}`);

  const caseIds = cases.map((c) => c._id);
  const now = new Date();
  const nextAppt = await AppointmentModel.find({
    caseId: { $in: caseIds },
    scheduledAt: { $gte: now },
    status: { $in: ['pending', 'accepted'] },
  })
    .sort({ scheduledAt: 1 })
    .limit(1)
    .select({ scheduledAt: 1, petitionerAttId: 1, legalAssistantId: 1 })
    .lean();

  if (nextAppt.length > 0) {
    const a = nextAppt[0] as { scheduledAt?: Date; petitionerAttId?: mongoose.Types.ObjectId; legalAssistantId?: mongoose.Types.ObjectId };
    const at = a.scheduledAt ? new Date(a.scheduledAt).toLocaleString() : '—';
    let withWho = '—';
    const attId = a.petitionerAttId?.toString();
    const laId = a.legalAssistantId?.toString();
    if (attId) {
      const att = await User.findById(attId).select({ firstName: 1, lastName: 1 }).lean();
      withWho = att ? displayName(att as { firstName?: string; lastName?: string; uname?: string }) : 'Petitioner attorney';
    }
    if (withWho === '—' && laId) {
      const la = await User.findById(laId).select({ firstName: 1, lastName: 1 }).lean();
      withWho = la ? displayName(la as { firstName?: string; lastName?: string; uname?: string }) : 'Legal assistant';
    }
    bullets.push(`**Next appointment:** ${at} — with ${withWho}`);
  } else {
    bullets.push(`**Next appointment:** None scheduled`);
  }

  return { bullets };
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

  const countyId = criteria.countyId != null && Number.isFinite(criteria.countyId) ? criteria.countyId : null;
  const [cases, countyNameById] = await Promise.all([
    getCasesForReport(auth, options?.filterUserId ?? null, countyId),
    getCountyNameMap(),
  ]);
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
    const countyName =
      c.countyId != null && Number.isFinite(c.countyId) ? countyNameById.get(c.countyId) ?? null : null;
    rows.push({
      caseId: c._id.toString(),
      caseNumber: c.caseNumber ?? '',
      partyRole,
      partyName: displayName(userDoc),
      grossAnnualIncome,
      under50K: grossAnnualIncome < 50000,
      numChildren: c.numChildren,
      countyName: countyName ?? undefined,
    });
  }

  return rows;
}
