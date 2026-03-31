/**
 * Phase 2: apply a pending_review extraction to affidavit data (append or merge by policy).
 * Mirrors client-side “apply disabled” rules for consistency.
 */

import mongoose from 'mongoose';
import type { DocumentExtractionDoc } from '../../models/document-extraction.model.js';
import { insertAffidavitRow, listAffidavitRows, patchAffidavitRow, userScopedFilter } from '../affidavit-store.js';

const PAY_FREQUENCY_ANNUALLY = 5;

export type IntakeConflictPolicy = 'append' | 'merge_if_match';

/** Normalize employer / creditor / utility names for merge matching. */
export function normalizeMatchKey(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function parseIntakeConflictPolicy(body: unknown): IntakeConflictPolicy {
  if (!body || typeof body !== 'object') return 'append';
  const p = (body as Record<string, unknown>)['conflictPolicy'];
  if (p === 'merge_if_match') return 'merge_if_match';
  return 'append';
}

export type IntakeMergeIdentity = {
  collection: string;
  key: string;
  liabilitiesTypeId?: number;
  expenseTypeId?: number;
};

/** Identity used to find an existing affidavit row when conflictPolicy is merge_if_match. */
export function mergeIdentityFromExtraction(
  extraction: Pick<DocumentExtractionDoc, 'documentType' | 'rawPayload'>
): IntakeMergeIdentity | null {
  const raw = extraction.rawPayload as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return null;
  const cls = classifiedType(extraction as any);

  switch (cls) {
    case 'w2': {
      const name = raw['employerName'];
      if (!nonemptyString(name)) return null;
      return { collection: 'employment', key: normalizeMatchKey(name) };
    }
    case 'mortgage_statement': {
      const lender = raw['lenderName'];
      const k = nonemptyString(lender) ? normalizeMatchKey(String(lender)) : normalizeMatchKey('Mortgage');
      return { collection: 'liabilities', liabilitiesTypeId: 1, key: k };
    }
    case 'utility_electric': {
      const u = raw['utilityName'];
      if (!nonemptyString(u)) return null;
      return { collection: 'monthlyhouseholdexpense', expenseTypeId: 5, key: normalizeMatchKey(u) };
    }
    case 'credit_card_mastercard': {
      const creditor = nonemptyString(raw['creditorName']) ? String(raw['creditorName']).trim() : '';
      const last4Raw = typeof raw['accountLast4'] === 'string' ? raw['accountLast4'].trim().replace(/\D/g, '') : '';
      const last4 = last4Raw.length ? last4Raw.slice(-4) : '';
      return {
        collection: 'liabilities',
        liabilitiesTypeId: 4,
        key: `${normalizeMatchKey(creditor)}|${last4}`
      };
    }
    default:
      return null;
  }
}

/** Merge key derived from an existing DB row (must match mergeIdentityFromExtraction). */
export function rowMergeKeyForIntake(collection: string, row: Record<string, unknown>): string | null {
  if (collection === 'employment') {
    return normalizeMatchKey(String(row['name'] ?? ''));
  }
  if (collection === 'liabilities') {
    const tid = Number(row['liabilitiesTypeId']);
    const desc = String(row['description'] ?? '').trim();
    if (tid === 1) {
      const first = desc.split('·')[0]?.trim() || desc;
      return normalizeMatchKey(first);
    }
    if (tid === 4) {
      const idx = desc.indexOf('…');
      if (idx >= 0) {
        const creditorPart = desc.slice(0, idx).trim();
        const after = desc.slice(idx + 1).replace(/\D/g, '').slice(-4) || '';
        return `${normalizeMatchKey(creditorPart)}|${after}`;
      }
      return `${normalizeMatchKey(desc)}|`;
    }
    return null;
  }
  if (collection === 'monthlyhouseholdexpense') {
    if (Number(row['typeId']) !== 5) return null;
    return normalizeMatchKey(String(row['ifOther'] ?? ''));
  }
  return null;
}

function rowMatchesMergeIdentity(collection: string, row: Record<string, unknown>, identity: IntakeMergeIdentity): boolean {
  const key = rowMergeKeyForIntake(collection, row);
  if (key == null || key !== identity.key) return false;
  if (collection === 'liabilities') {
    return Number(row['liabilitiesTypeId']) === identity.liabilitiesTypeId;
  }
  if (collection === 'monthlyhouseholdexpense') {
    return Number(row['typeId']) === identity.expenseTypeId;
  }
  return true;
}

export function pickNewestMergeCandidate(
  collection: string,
  rows: Record<string, unknown>[],
  identity: IntakeMergeIdentity
): Record<string, unknown> | null {
  const matches = rows.filter((r) => rowMatchesMergeIdentity(collection, r, identity));
  if (matches.length === 0) return null;
  matches.sort((a, b) => String(b['_id'] ?? '').localeCompare(String(a['_id'] ?? '')));
  return matches[0] ?? null;
}

function buildMergePatch(plan: AffidavitInsertPlan): Record<string, unknown> {
  const d = plan.document;
  const now = new Date();
  if (plan.collection === 'employment') {
    return {
      name: d['name'],
      occupation: d['occupation'],
      payRate: d['payRate'],
      payFrequencyTypeId: d['payFrequencyTypeId'],
      payFrequencyIfOther: d['payFrequencyIfOther'],
      retired: d['retired'],
      updatedAt: now
    };
  }
  if (plan.collection === 'liabilities') {
    return {
      description: d['description'],
      amountOwed: d['amountOwed'],
      userOwes: d['userOwes'],
      nonMaritalTypeId: d['nonMaritalTypeId'],
      updatedAt: now
    };
  }
  if (plan.collection === 'monthlyhouseholdexpense') {
    return {
      amount: d['amount'],
      ifOther: d['ifOther'],
      updatedAt: new Date()
    };
  }
  return {};
}

function snapshotRowForAudit(collection: string, row: Record<string, unknown>): Record<string, unknown> {
  if (collection === 'employment') {
    return {
      name: row['name'],
      occupation: row['occupation'],
      payRate: row['payRate'],
      payFrequencyTypeId: row['payFrequencyTypeId'],
      retired: row['retired']
    };
  }
  if (collection === 'liabilities') {
    return {
      liabilitiesTypeId: row['liabilitiesTypeId'],
      description: row['description'],
      amountOwed: row['amountOwed'],
      userOwes: row['userOwes'],
      nonMaritalTypeId: row['nonMaritalTypeId']
    };
  }
  if (collection === 'monthlyhouseholdexpense') {
    return { typeId: row['typeId'], ifOther: row['ifOther'], amount: row['amount'] };
  }
  return {};
}

function buildAppliedValuesSnapshot(plan: AffidavitInsertPlan): Record<string, unknown> {
  return snapshotRowForAudit(plan.collection, plan.document);
}

export type IntakeApplyWriteResult = {
  rowId: string;
  action: 'insert' | 'update';
  previousValues: Record<string, unknown> | null;
  appliedValues: Record<string, unknown>;
};

/** Insert a new affidavit row, or merge into an existing row when policy and identity match. */
export async function applyIntakePlanWithPolicy(params: {
  subjectUserId: mongoose.Types.ObjectId;
  extraction: Pick<DocumentExtractionDoc, 'documentType' | 'rawPayload'>;
  plan: AffidavitInsertPlan;
  conflictPolicy: IntakeConflictPolicy;
}): Promise<IntakeApplyWriteResult> {
  const { subjectUserId, extraction, plan, conflictPolicy } = params;
  const filter = userScopedFilter(subjectUserId.toString());
  const appliedValues = buildAppliedValuesSnapshot(plan);

  if (conflictPolicy === 'append') {
    const rowId = await insertAffidavitRow(plan.collection, plan.document);
    return { rowId, action: 'insert', previousValues: null, appliedValues };
  }

  const identity = mergeIdentityFromExtraction(extraction);
  if (!identity) {
    const rowId = await insertAffidavitRow(plan.collection, plan.document);
    return { rowId, action: 'insert', previousValues: null, appliedValues };
  }

  const rows = (await listAffidavitRows(plan.collection, filter)) as Record<string, unknown>[];
  const match = pickNewestMergeCandidate(plan.collection, rows, identity);

  if (!match || match['_id'] == null) {
    const rowId = await insertAffidavitRow(plan.collection, plan.document);
    return { rowId, action: 'insert', previousValues: null, appliedValues };
  }

  const previousValues = snapshotRowForAudit(plan.collection, match);
  const patch = buildMergePatch(plan);
  const ok = await patchAffidavitRow(plan.collection, String(match['_id']), filter, patch);
  if (!ok) {
    const rowId = await insertAffidavitRow(plan.collection, plan.document);
    return { rowId, action: 'insert', previousValues: null, appliedValues };
  }

  return {
    rowId: String(match['_id']),
    action: 'update',
    previousValues,
    appliedValues
  };
}

function nonemptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function finiteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function classifiedType(extraction: Pick<DocumentExtractionDoc, 'documentType' | 'rawPayload'>): string {
  const raw = extraction.rawPayload as Record<string, unknown> | null | undefined;
  if (raw && typeof raw === 'object') {
    const c = raw['classifiedType'];
    if (typeof c === 'string' && c.length) return c;
  }
  return extraction.documentType;
}

/** Same rules as client applyDisabled (inverse: return error message if blocked). */
export function getIntakeApplyBlockReason(extraction: {
  status: string;
  textQuality?: { weak?: boolean } | null;
  rawPayload?: unknown;
  documentType: string;
}): string | null {
  if (extraction.status !== 'pending_review') return 'Only pending_review extractions can be applied.';
  if (extraction.textQuality?.weak) return 'Apply is blocked: text quality is weak.';
  const raw = extraction.rawPayload;
  if (raw && typeof raw === 'object') {
    const note = (raw as Record<string, unknown>)['ocrNote'];
    if (typeof note === 'string' && note.trim().length) {
      return 'Apply is blocked: document text was flagged as low-quality or scan-like.';
    }
  }
  if (intakeRequiredFieldsMissing(extraction)) {
    return 'Apply is blocked: required extracted fields are missing.';
  }
  return null;
}

function intakeRequiredFieldsMissing(extraction: { rawPayload?: unknown; documentType: string }): boolean {
  const p = extraction.rawPayload;
  if (!p || typeof p !== 'object') return true;
  const raw = p as Record<string, unknown>;
  const cls = classifiedType(extraction as any);

  switch (cls) {
    case 'w2':
      return !finiteNumber(raw['box1WagesTipsOther']) || !nonemptyString(raw['employerName']);
    case 'mortgage_statement':
      return !finiteNumber(raw['principalBalance']);
    case 'utility_electric':
      return !finiteNumber(raw['amountDue']) || !nonemptyString(raw['utilityName']);
    case 'credit_card_mastercard':
      return !finiteNumber(raw['statementBalance']);
    case 'unknown':
      return true;
    default:
      return true;
  }
}

export type AffidavitInsertPlan = { collection: string; document: Record<string, unknown> };

export function buildAffidavitInsertPlan(
  extraction: Pick<DocumentExtractionDoc, 'documentType' | 'rawPayload'>,
  subjectUserId: mongoose.Types.ObjectId
): AffidavitInsertPlan | null {
  const raw = extraction.rawPayload as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return null;

  const userId = subjectUserId;
  const now = new Date();
  const cls = classifiedType(extraction as any);

  switch (cls) {
    case 'w2': {
      const payRate = raw['box1WagesTipsOther'];
      const name = raw['employerName'];
      if (!finiteNumber(payRate) || !nonemptyString(name)) return null;
      const taxYear = raw['taxYear'];
      const occupation =
        typeof taxYear === 'string' && taxYear.trim()
          ? `W-2 (tax year ${taxYear.trim()})`
          : 'W-2';
      return {
        collection: 'employment',
        document: {
          userId,
          name: name.trim(),
          occupation,
          payRate,
          payFrequencyTypeId: PAY_FREQUENCY_ANNUALLY,
          payFrequencyIfOther: null,
          retired: false,
          createdAt: now
        }
      };
    }
    case 'mortgage_statement': {
      const amountOwed = raw['principalBalance'];
      const lender = raw['lenderName'];
      if (!finiteNumber(amountOwed)) return null;
      const loan = raw['loanNumber'];
      const descParts = [typeof lender === 'string' && lender.trim() ? lender.trim() : 'Mortgage'];
      if (typeof loan === 'string' && loan.trim()) descParts.push(`Loan #${loan.trim()}`);
      return {
        collection: 'liabilities',
        document: {
          userId,
          liabilitiesTypeId: 1,
          description: descParts.join(' · ').slice(0, 500),
          amountOwed,
          nonMaritalTypeId: null,
          userOwes: true,
          createdAt: now
        }
      };
    }
    case 'utility_electric': {
      const amount = raw['amountDue'];
      const utility = raw['utilityName'];
      if (!finiteNumber(amount) || !nonemptyString(utility)) return null;
      return {
        collection: 'monthlyhouseholdexpense',
        document: {
          userId,
          typeId: 5,
          amount,
          ifOther: utility.trim().slice(0, 500),
          createdAt: now
        }
      };
    }
    case 'credit_card_mastercard': {
      const amountOwed = raw['statementBalance'];
      if (!finiteNumber(amountOwed)) return null;
      const creditor = raw['creditorName'];
      const last4 = raw['accountLast4'];
      const descParts: string[] = [];
      if (nonemptyString(creditor)) descParts.push(creditor.trim());
      if (typeof last4 === 'string' && last4.trim()) descParts.push(`…${last4.trim()}`);
      const description = descParts.length ? descParts.join(' ').slice(0, 500) : 'Credit card';
      return {
        collection: 'liabilities',
        document: {
          userId,
          liabilitiesTypeId: 4,
          description,
          amountOwed,
          nonMaritalTypeId: null,
          userOwes: true,
          createdAt: now
        }
      };
    }
    default:
      return null;
  }
}
