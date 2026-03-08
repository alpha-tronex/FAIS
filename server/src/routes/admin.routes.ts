import mongoose from 'mongoose';
import express from 'express';
import OpenAI from 'openai';
import { getOpenAIClient } from '../lib/openai.js';
import {
  validateAndSanitizeQuery,
  validateAndSanitizeAggregate,
  runMongoFind,
  runMongoAggregate,
} from '../lib/mongo-query-runner.js';
import { retrieveSimilarExamples } from '../lib/ai-query-rag.js';
import { getSchemaForPrompt } from '../lib/ai-query-schema-discovery.js';
import { getRelationshipGraphText } from '../lib/ai-query-relationship-graph.js';
import { enrichQuestionWithIds } from '../lib/ai-query-id-enrichment.js';
import { sendError, sendErrorWithMessage } from './error.js';
import type { AuthMiddlewares } from './middleware.js';

const RESULT_SIZE_THRESHOLD_FOR_SUMMARY = 8; // If more than this many rows, call summary LLM
const MAX_RESULT_JSON_CHARS = 8000;

/** Ensure a county filter is applied in the first $lookup to 'case' when we have a resolved countyId (e.g. "income in Broward"). */
function injectCountyIdIntoCaseLookup(pipeline: unknown[], countyId: number): void {
  for (const stage of pipeline) {
    if (stage == null || typeof stage !== 'object' || Array.isArray(stage)) continue;
    const s = stage as Record<string, unknown>;
    const lookup = s.$lookup;
    if (lookup == null || typeof lookup !== 'object' || Array.isArray(lookup)) continue;
    const from = (lookup as Record<string, unknown>).from;
    if (typeof from !== 'string' || from.trim().toLowerCase() !== 'case') continue;
    const sub = (lookup as Record<string, unknown>).pipeline as unknown[] | undefined;
    if (!Array.isArray(sub) || sub.length === 0) continue;
    const first = sub[0];
    if (first == null || typeof first !== 'object' || Array.isArray(first)) continue;
    const matchStage = first as Record<string, unknown>;
    if (matchStage.$match == null || typeof matchStage.$match !== 'object') continue;
    const match = matchStage.$match as Record<string, unknown>;
    if (match.countyId !== undefined && match.countyId !== null) return;
    if (match.$and && Array.isArray(match.$and)) {
      (match.$and as unknown[]).push({ countyId });
    } else {
      matchStage.$match = { $and: [match, { countyId }] };
    }
    return;
  }
}

/** Parse "top N" / "first N" / "N counties" from the question so we can enforce $limit in the pipeline. */
function parseTopNFromQuestion(question: string): number | null {
  const lower = question.toLowerCase().trim();
  const topFirst = lower.match(/(?:top|first)\s*(\d+)/);
  if (topFirst) return Math.min(100, Math.max(1, parseInt(topFirst[1]!, 10)));
  const nCounties = lower.match(/(\d+)\s*counties?/);
  if (nCounties) return Math.min(100, Math.max(1, parseInt(nCounties[1]!, 10)));
  const listTop = lower.match(/list\s+top\s+(\d+)/);
  if (listTop) return Math.min(100, Math.max(1, parseInt(listTop[1]!, 10)));
  return null;
}

/** Ensure aggregation pipeline returns at least N results when the user asked for "top N" / "N counties". */
function ensurePipelineLimitForTopN(pipeline: unknown[], n: number): unknown[] {
  if (!Array.isArray(pipeline) || n < 1) return pipeline;
  const out = pipeline.map((s) => (typeof s === 'object' && s !== null ? { ...(s as object) } : s));
  let lastLimitIndex = -1;
  for (let i = 0; i < out.length; i++) {
    const stage = out[i] as Record<string, unknown>;
    if (stage && typeof stage === 'object' && '$limit' in stage) lastLimitIndex = i;
  }
  const limitN = Math.min(100, Math.max(1, n));
  if (lastLimitIndex >= 0) {
    (out[lastLimitIndex] as Record<string, unknown>)['$limit'] = limitN;
  } else {
    out.push({ $limit: limitN });
  }
  return out;
}

/** Load users by _id from the users collection (firstName, lastName for full name). */
async function resolveUsers(
  userIds: mongoose.Types.ObjectId[]
): Promise<{ _id: string; firstName?: string; lastName?: string; uname?: string }[]> {
  if (userIds.length === 0) return [];
  const docs = await mongoose.connection
    .collection('users')
    .find({ _id: { $in: userIds } })
    .project({ firstName: 1, lastName: 1, uname: 1 })
    .toArray();
  return (docs as { _id: mongoose.Types.ObjectId; firstName?: string; lastName?: string; uname?: string }[]).map(
    (d) => ({
      _id: d._id.toString(),
      firstName: d.firstName,
      lastName: d.lastName,
      uname: d.uname,
    })
  );
}

const CASE_USER_FIELDS = [
  'petitionerId',
  'respondentId',
  'petitionerAttId',
  'respondentAttId',
  'legalAssistantId',
] as const;

function getUserIdsForLookup(results: unknown[], collection: string): mongoose.Types.ObjectId[] {
  const ids = new Set<string>();
  const col = collection?.trim().toLowerCase() ?? '';
  const isUsersCollection = col === 'users';
  const isCaseCollection = col === 'case';
  for (const doc of results) {
    if (!doc || typeof doc !== 'object') continue;
    const d = doc as Record<string, unknown>;
    if (isUsersCollection && d._id) {
      const v = d._id;
      if (v instanceof mongoose.Types.ObjectId) ids.add(v.toString());
      else if (typeof v === 'string' && mongoose.isValidObjectId(v)) ids.add(v);
    } else if (isCaseCollection) {
      for (const key of CASE_USER_FIELDS) {
        const v = d[key];
        if (v instanceof mongoose.Types.ObjectId) ids.add(v.toString());
        else if (typeof v === 'string' && mongoose.isValidObjectId(v)) ids.add(v);
      }
    } else if (d.userId) {
      const v = d.userId;
      if (v instanceof mongoose.Types.ObjectId) ids.add(v.toString());
      else if (typeof v === 'string' && mongoose.isValidObjectId(v)) ids.add(v);
    }
  }
  return Array.from(ids)
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

/** Extract numeric county IDs from results (_id or countyId, e.g. from aggregation). */
function getCountyIdsFromResults(results: unknown[]): number[] {
  const ids = new Set<number>();
  for (const doc of results) {
    if (!doc || typeof doc !== 'object') continue;
    const d = doc as Record<string, unknown>;
    if (typeof d._id === 'number' && Number.isInteger(d._id)) ids.add(d._id);
    if (typeof d.countyId === 'number' && Number.isInteger(d.countyId)) ids.add(d.countyId);
  }
  return Array.from(ids);
}

/** Extract numeric circuit IDs from results (_id or circuitId). */
function getCircuitIdsFromResults(results: unknown[]): number[] {
  const ids = new Set<number>();
  for (const doc of results) {
    if (!doc || typeof doc !== 'object') continue;
    const d = doc as Record<string, unknown>;
    if (typeof d._id === 'number' && Number.isInteger(d._id)) ids.add(d._id);
    if (typeof d.circuitId === 'number' && Number.isInteger(d.circuitId)) ids.add(d.circuitId);
  }
  return Array.from(ids);
}

/** Extract numeric state IDs from results (_id or stateId). */
function getStateIdsFromResults(results: unknown[]): number[] {
  const ids = new Set<number>();
  for (const doc of results) {
    if (!doc || typeof doc !== 'object') continue;
    const d = doc as Record<string, unknown>;
    if (typeof d._id === 'number' && Number.isInteger(d._id)) ids.add(d._id);
    if (typeof d.stateId === 'number' && Number.isInteger(d.stateId)) ids.add(d.stateId);
  }
  return Array.from(ids);
}

/** Extract numeric division IDs from results (_id or divisionId). */
function getDivisionIdsFromResults(results: unknown[]): number[] {
  const ids = new Set<number>();
  for (const doc of results) {
    if (!doc || typeof doc !== 'object') continue;
    const d = doc as Record<string, unknown>;
    if (typeof d._id === 'number' && Number.isInteger(d._id)) ids.add(d._id);
    if (typeof d.divisionId === 'number' && Number.isInteger(d.divisionId)) ids.add(d.divisionId);
  }
  return Array.from(ids);
}

/** Extract numeric role type IDs from results (_id or roleTypeId). */
function getRoleTypeIdsFromResults(results: unknown[]): number[] {
  const ids = new Set<number>();
  for (const doc of results) {
    if (!doc || typeof doc !== 'object') continue;
    const d = doc as Record<string, unknown>;
    if (typeof d._id === 'number' && Number.isInteger(d._id)) ids.add(d._id);
    if (typeof d.roleTypeId === 'number' && Number.isInteger(d.roleTypeId)) ids.add(d.roleTypeId);
  }
  return Array.from(ids);
}

/** Resolve county IDs to names from lookup_counties. */
async function resolveCounties(
  countyIds: number[]
): Promise<{ id: number; name: string }[]> {
  if (countyIds.length === 0) return [];
  const docs = await mongoose.connection
    .collection('lookup_counties')
    .find({ id: { $in: countyIds } })
    .project({ id: 1, name: 1 })
    .toArray();
  return (docs as { id?: number; name?: string }[])
    .filter((r) => typeof r.id === 'number' && r.name != null)
    .map((r) => ({ id: r.id!, name: String(r.name).trim() }));
}

/** Resolve circuit IDs to names from lookup_circuits. */
async function resolveCircuits(
  circuitIds: number[]
): Promise<{ id: number; name: string }[]> {
  if (circuitIds.length === 0) return [];
  const docs = await mongoose.connection
    .collection('lookup_circuits')
    .find({ id: { $in: circuitIds } })
    .project({ id: 1, name: 1 })
    .toArray();
  return (docs as { id?: number; name?: string }[])
    .filter((r) => typeof r.id === 'number' && r.name != null)
    .map((r) => ({ id: r.id!, name: String(r.name).trim() }));
}

/** Resolve state IDs to names from lookup_states. */
async function resolveStates(
  stateIds: number[]
): Promise<{ id: number; name: string }[]> {
  if (stateIds.length === 0) return [];
  const docs = await mongoose.connection
    .collection('lookup_states')
    .find({ id: { $in: stateIds } })
    .project({ id: 1, name: 1 })
    .toArray();
  return (docs as { id?: number; name?: string }[])
    .filter((r) => typeof r.id === 'number' && r.name != null)
    .map((r) => ({ id: r.id!, name: String(r.name).trim() }));
}

/** Resolve division IDs to names from lookup_divisions. */
async function resolveDivisions(
  divisionIds: number[]
): Promise<{ id: number; name: string }[]> {
  if (divisionIds.length === 0) return [];
  const docs = await mongoose.connection
    .collection('lookup_divisions')
    .find({ id: { $in: divisionIds } })
    .project({ id: 1, name: 1 })
    .toArray();
  return (docs as { id?: number; name?: string }[])
    .filter((r) => typeof r.id === 'number' && r.name != null)
    .map((r) => ({ id: r.id!, name: String(r.name).trim() }));
}

/** Resolve role type IDs to names from lookup_role_types. */
async function resolveRoleTypes(
  roleTypeIds: number[]
): Promise<{ id: number; name: string }[]> {
  if (roleTypeIds.length === 0) return [];
  const docs = await mongoose.connection
    .collection('lookup_role_types')
    .find({ id: { $in: roleTypeIds } })
    .project({ id: 1, name: 1 })
    .toArray();
  return (docs as { id?: number; name?: string }[])
    .filter((r) => typeof r.id === 'number' && r.name != null)
    .map((r) => ({ id: r.id!, name: String(r.name).trim() }));
}

async function fetchAppointmentsForUsers(userIds: mongoose.Types.ObjectId[]): Promise<unknown[]> {
  if (userIds.length === 0) return [];
  const now = new Date();
  const docs = await mongoose.connection
    .collection('appointments')
    .find({
      $or: [
        { petitionerId: { $in: userIds } },
        { petitionerAttId: { $in: userIds } },
        { legalAssistantId: { $in: userIds } },
      ],
      scheduledAt: { $gte: now },
      status: { $nin: ['cancelled', 'rejected'] },
    })
    .sort({ scheduledAt: 1 })
    .limit(20)
    .project({ scheduledAt: 1, durationMinutes: 1, status: 1, caseId: 1, petitionerId: 1 })
    .toArray();
  return docs as unknown[];
}

async function fetchAssetsForUsers(userIds: mongoose.Types.ObjectId[]): Promise<unknown[]> {
  if (userIds.length === 0) return [];
  const docs = await mongoose.connection
    .collection('assets')
    .find({ userId: { $in: userIds } })
    .project({ description: 1, marketValue: 1, assetsTypeId: 1 })
    .toArray();
  return docs as unknown[];
}

/** Step 2: Check if the question is ambiguous. Returns clarification string if ambiguous, null if clear. */
async function checkAmbiguity(client: OpenAI, question: string): Promise<string | null> {
  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You determine if the user's question has GENUINE ambiguity that would make it impossible to run a single database query.

ONLY ask for clarification in these cases:
- Ambiguous location: e.g. "Miami" (city vs Miami-Dade county) → "Do you mean Miami-Dade county?"
- Multiple people with the same name: e.g. "affidavit for John Smith" when several users match → "Which John Smith? Multiple records exist."

Do NOT ask for clarification about:
- Scope or preference (e.g. "all" vs "specific", "which type of loan", "which state", "all counties"). Interpret the question and any follow-up text reasonably—if the user said "Florida", "all", "yes", or gave a type like "Bank/Credit Union loan", treat that as enough.
- Missing details that the query can still be run (e.g. "which counties have liabilities" can be answered by querying liabilities and grouping by county; do not ask "which liabilities" or "which state").

If the question (including any appended follow-up) is interpretable enough to run a query, respond with exactly: CLEAR`,
      },
      { role: 'user', content: question },
    ],
    max_tokens: 100,
  });
  const text = res.choices?.[0]?.message?.content?.trim() ?? '';
  if (text.toUpperCase() === 'CLEAR') return null;
  return text;
}

const QUERY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'query_mongodb',
    description: 'Run a read-only MongoDB find or aggregate query. Use only allowed collections.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['find', 'aggregate'],
          description: 'find for simple filter; aggregate for $group, $sort, etc.',
        },
        collection: { type: 'string', description: 'Collection name' },
        filter: { type: 'object', description: 'MongoDB filter (required for find)' },
        projection: { type: 'object', description: 'Optional projection (find only)' },
        limit: { type: 'number', description: 'Max docs (1-500, find only)' },
        pipeline: {
          type: 'array',
          description: 'Aggregation pipeline (required for aggregate). Allowed stages: $match, $group, $sort, $limit, $project, $count',
          items: { type: 'object' },
        },
      },
      required: ['type', 'collection'],
    },
  },
};

/**
 * Format small aggregation results (e.g. by county) with resolved names when we skip the summary LLM.
 * Covers all affidavit-by-county (or circuit/state/division/role) result shapes:
 * - assets: totalAssets, totalValue
 * - liabilities: totalLiabilities
 * - monthlyincome: avgIncome, totalIncome (or averageIncome)
 * - employment: totalEmployment
 */
/** Return type for list-style summaries (e.g. counties with income): summary text and lines for ul/li display. */
function formatSmallResultSummary(
  results: unknown[],
  resolvedCounties: { id: number; name: string }[],
  resolvedCircuits: { id: number; name: string }[],
  resolvedStates: { id: number; name: string }[],
  resolvedDivisions: { id: number; name: string }[],
  resolvedRoleTypes: { id: number; name: string }[]
): { summary: string; lines: string[] } | null {
  if (results.length === 0) return null;
  const first = results[0] as Record<string, unknown> | undefined;
  const id = first?._id;
  // Single-doc aggregate (e.g. "least income in Broward" or "who has the least income") — use person name if present, else county
  if (
    results.length === 1 &&
    (id === undefined || id === null || typeof id !== 'number')
  ) {
    const r = first as Record<string, unknown>;
    const leastIncome = r.leastIncome ?? (r as { minIncome?: number }).minIncome;
    const maxIncome = r.maxIncome;
    const avgInc = r.avgIncome ?? r.averageIncome;
    const totalIncome = r.totalIncome;
    const parts: string[] = [];
    if (leastIncome != null && typeof leastIncome === 'number') parts.push(`least income $${Number(leastIncome).toLocaleString()}`);
    if (maxIncome != null && typeof maxIncome === 'number') parts.push(`highest income $${Number(maxIncome).toLocaleString()}`);
    if (avgInc != null && typeof avgInc === 'number') parts.push(`avg income $${Number(avgInc).toLocaleString()}`);
    if (totalIncome != null && typeof totalIncome === 'number') parts.push(`total income $${Number(totalIncome).toLocaleString()}`);
    if (parts.length > 0) {
      const firstN = String(r.firstName ?? '').trim();
      const lastN = String(r.lastName ?? '').trim();
      const personName = [firstN, lastN].filter(Boolean).join(' ').trim();
      const countyName = resolvedCounties.length > 0 ? resolvedCounties[0].name : '';
      const label = personName
        ? (countyName ? `${personName} (${countyName} county)` : personName)
        : countyName || 'Result';
      const line = `${label}: ${parts.join(', ')}`;
      return { summary: line, lines: [line] };
    }
  }
  if (typeof id !== 'number') return null;
  const countyMap = new Map(resolvedCounties.map((c) => [c.id, c.name]));
  const circuitMap = new Map(resolvedCircuits.map((c) => [c.id, c.name]));
  const stateMap = new Map(resolvedStates.map((s) => [s.id, s.name]));
  const divisionMap = new Map(resolvedDivisions.map((d) => [d.id, d.name]));
  const roleMap = new Map(resolvedRoleTypes.map((r) => [r.id, r.name]));
  const nameById =
    countyMap.get(id) ?? circuitMap.get(id) ?? stateMap.get(id) ?? divisionMap.get(id) ?? roleMap.get(id);
  if (!nameById && resolvedCounties.length === 0 && resolvedCircuits.length === 0 && resolvedStates.length === 0 && resolvedDivisions.length === 0 && resolvedRoleTypes.length === 0) return null;

  const lines = (results as Record<string, unknown>[]).map((r) => {
    const rid = r._id;
    const name =
      typeof rid === 'number'
        ? countyMap.get(rid) ?? circuitMap.get(rid) ?? stateMap.get(rid) ?? divisionMap.get(rid) ?? roleMap.get(rid) ?? `ID ${rid}`
        : String(rid);
    const parts: string[] = [];
    // Assets (affidavit)
    if (r.totalAssets != null) parts.push(`${r.totalAssets} assets`);
    if (r.totalValue != null) parts.push(`$${Number(r.totalValue).toLocaleString()} total value`);
    // Liabilities (affidavit) — include total amount and optional type/amount list
    if (r.totalLiabilities != null) {
      const liabilityParts = [`${r.totalLiabilities} liabilities`];
      if (r.totalAmount != null && Number(r.totalAmount) >= 0) {
        liabilityParts.push(`$${Number(r.totalAmount).toLocaleString()} total`);
      }
      const items = r.items as Array<{ description?: string; amount?: number }> | undefined;
      if (Array.isArray(items) && items.length > 0) {
        const detail = items
          .slice(0, 8)
          .map((i) => `${String(i.description || 'Liability').trim()}: $${Number(i.amount ?? 0).toLocaleString()}`)
          .join('; ');
        liabilityParts.push(`(${detail}${items.length > 8 ? '…' : ''})`);
      }
      parts.push(liabilityParts.join(', '));
    }
    // Monthly income (affidavit) — include type names and amounts when present
    const avgInc = r.avgIncome ?? r.averageIncome;
    if (avgInc != null) parts.push(`avg income $${Number(avgInc).toLocaleString()}`);
    if (r.totalIncome != null) parts.push(`total income $${Number(r.totalIncome).toLocaleString()}`);
    const incomeItems = r.items as Array<{ typeName?: string; amount?: number }> | undefined;
    if (Array.isArray(incomeItems) && incomeItems.length > 0 && incomeItems.some((i) => i.typeName != null || i.amount != null)) {
      const detail = incomeItems
        .slice(0, 8)
        .map((i) => `${String(i.typeName || 'Income').trim()}: $${Number(i.amount ?? 0).toLocaleString()}`)
        .join('; ');
      parts.push(`(${detail}${incomeItems.length > 8 ? '…' : ''})`);
    }
    // Employment (affidavit)
    if (r.totalEmployment != null) parts.push(`${r.totalEmployment} employment records`);
    return parts.length > 0 ? `${name}: ${parts.join(', ')}` : `${name}`;
  });
  return { summary: lines.join('. '), lines };
}

/** Format small result sets that are person lists (firstName, lastName + metric) when we skip the summary LLM. */
function formatPersonListSummary(results: unknown[]): string | null {
  if (results.length === 0) return null;
  const first = results[0] as Record<string, unknown> | undefined;
  const hasName = first && ('firstName' in first || 'lastName' in first) && (first.firstName != null || first.lastName != null);
  if (!hasName) return null;
  const lines = (results as Record<string, unknown>[]).map((r) => {
    const f = String(r.firstName ?? '');
    const l = String(r.lastName ?? '');
    const name = [f, l].filter(Boolean).join(' ').trim() || 'Unknown';
    const parts: string[] = [];
    if (r.totalIncome != null) parts.push(`$${Number(r.totalIncome).toLocaleString()} total income`);
    const avgInc = r.avgIncome ?? r.averageIncome;
    if (avgInc != null) parts.push(`$${Number(avgInc).toLocaleString()} avg income`);
    if (r.totalAssets != null) parts.push(`${r.totalAssets} assets`);
    if (r.totalValue != null) parts.push(`$${Number(r.totalValue).toLocaleString()} total value`);
    if (r.totalLiabilities != null) parts.push(`${r.totalLiabilities} liabilities`);
    if (r.totalEmployment != null) parts.push(`${r.totalEmployment} employment records`);
    return parts.length > 0 ? `${name}: ${parts.join(', ')}` : name;
  });
  return lines.join('. ');
}

const CASE_USER_FIELDS_FOR_GROUPING = [
  'petitionerId',
  'respondentId',
  'petitionerAttId',
  'respondentAttId',
  'legalAssistantId',
] as const;

/** Format small result sets that are case documents (caseNumber, division). When resolvedUsers is provided, group by involved user (title + items). requestedUserIds preserves question order. */
function formatCaseListSummary(
  results: unknown[],
  resolvedUsers?: ResolvedUser[],
  requestedUserIds?: string[]
): string | { summary: string; sections: { title: string; items: string[] }[] } | null {
  if (results.length === 0) return null;
  const first = results[0] as Record<string, unknown> | undefined;
  const hasCaseNumber = first && typeof first.caseNumber === 'string';
  if (!hasCaseNumber) return null;
  const rows = results as Record<string, unknown>[];

  const formatCase = (r: Record<string, unknown>) => {
    const num = String(r.caseNumber ?? '').trim();
    const div = typeof r.division === 'string' ? r.division.trim() : '';
    return div ? `${num} (${div})` : num;
  };

  const flatLines = rows.map(formatCase);
  const n = flatLines.length;
  const noun = n === 1 ? 'case' : 'cases';
  const summary = `${n} ${noun}: ${flatLines.join(', ')}.`;

  if (resolvedUsers?.length) {
    const userMap = new Map<string, ResolvedUser>(resolvedUsers.map((u) => [u._id, u]));
    const casesByUser = new Map<string, string[]>();
    for (const r of rows) {
      const caseStr = formatCase(r);
      for (const key of CASE_USER_FIELDS_FOR_GROUPING) {
        const uid = r[key];
        const uidStr =
          uid instanceof mongoose.Types.ObjectId ? uid.toString() : uid != null ? String(uid) : '';
        if (!uidStr) continue;
        if (!casesByUser.has(uidStr)) casesByUser.set(uidStr, []);
        if (!casesByUser.get(uidStr)!.includes(caseStr)) casesByUser.get(uidStr)!.push(caseStr);
      }
    }
    const order =
      requestedUserIds?.length &&
      requestedUserIds.some((id) => casesByUser.has(id))
        ? requestedUserIds.filter((id) => (casesByUser.get(id) ?? []).length > 0)
        : resolvedUsers.map((u) => u._id);
    const sections: { title: string; items: string[] }[] = [];
    for (const uid of order) {
      const items = casesByUser.get(uid) ?? [];
      if (items.length === 0) continue;
      const user = userMap.get(uid);
      const title = user ? getUserDisplayName(user) : uid || 'Unknown';
      sections.push({ title, items });
    }
    if (sections.length > 0) return { summary, sections };
  }

  return summary;
}

type ResolvedUser = { _id: string; firstName?: string; lastName?: string; uname?: string };

function getUserDisplayName(u: ResolvedUser): string {
  const first = String(u.firstName ?? '').trim();
  const last = String(u.lastName ?? '').trim();
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || String(u.uname ?? '').trim() || 'Unknown';
}

/** Format result sets that are affidavit lists (employment, monthlyincome, assets, liabilities). When resolvedUsers is provided, group by petitioner with title + items. */
function formatAffidavitListSummary(
  results: unknown[],
  resolvedUsers?: ResolvedUser[]
): { summary: string; lines: string[]; sections?: { title: string; items: string[] }[] } | null {
  if (results.length === 0) return null;
  const first = results[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== 'object') return null;
  const hasUserId = 'userId' in first && first.userId != null;
  const userMap = resolvedUsers?.length && hasUserId
    ? new Map<string, ResolvedUser>(resolvedUsers.map((u) => [u._id, u]))
    : null;

  const formatEmployment = (r: Record<string, unknown>) => {
    const employer = String(r.name ?? '').trim() || 'Employer';
    const occupation = String(r.occupation ?? '').trim();
    const rate = typeof r.payRate === 'number' ? `$${Number(r.payRate).toLocaleString()}/month` : '';
    return occupation ? `${employer}, ${occupation}${rate ? `, ${rate}` : ''}` : `${employer}${rate ? `, ${rate}` : ''}`;
  };
  const formatIncome = (r: Record<string, unknown>) => {
    const amt = typeof r.amount === 'number' ? `$${Number(r.amount).toLocaleString()}` : '';
    return amt ? `Income: ${amt}` : '—';
  };
  const formatAsset = (r: Record<string, unknown>) => {
    const desc = String(r.description ?? '').trim() || 'Asset';
    const val = typeof r.marketValue === 'number' ? `$${Number(r.marketValue).toLocaleString()}` : '';
    return val ? `${desc}, ${val}` : desc;
  };
  const formatLiability = (r: Record<string, unknown>) => {
    const desc = String(r.description ?? '').trim() || 'Liability';
    const owed = typeof r.amountOwed === 'number' ? `$${Number(r.amountOwed).toLocaleString()}` : '';
    return owed ? `${desc}, ${owed}` : desc;
  };

  const groupByUserId = (rows: Record<string, unknown>[], format: (r: Record<string, unknown>) => string) => {
    const byUser = new Map<string, string[]>();
    for (const r of rows) {
      const uid = r.userId instanceof mongoose.Types.ObjectId ? r.userId.toString() : String(r.userId ?? '');
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid)!.push(format(r));
    }
    const sections: { title: string; items: string[] }[] = [];
    for (const [uid, items] of byUser) {
      const user = userMap?.get(uid);
      const title = user ? getUserDisplayName(user) : uid || 'Unknown';
      sections.push({ title, items });
    }
    return sections;
  };

  // Employment: name (employer), occupation, payRate
  if ('payRate' in first && 'name' in first) {
    const rows = results as Record<string, unknown>[];
    const lines = rows.map(formatEmployment);
    if (userMap && hasUserId) {
      const sections = groupByUserId(rows, formatEmployment);
      return { summary: `Employment (${lines.length}): ${lines.join('; ')}.`, lines, sections };
    }
    return { summary: `Employment (${lines.length}): ${lines.join('; ')}.`, lines };
  }

  // Monthly income: amount, typeId
  if ('amount' in first && 'typeId' in first && !('marketValue' in first) && !('amountOwed' in first)) {
    const rows = results as Record<string, unknown>[];
    const lines = rows.map(formatIncome);
    if (userMap && hasUserId) {
      const sections = groupByUserId(rows, formatIncome);
      return { summary: `Monthly income (${lines.length} source(s)): ${lines.join('; ')}.`, lines, sections };
    }
    return { summary: `Monthly income (${lines.length} source(s)): ${lines.join('; ')}.`, lines };
  }

  // Assets: description, marketValue
  if ('marketValue' in first && 'description' in first) {
    const rows = results as Record<string, unknown>[];
    const lines = rows.map(formatAsset);
    if (userMap && hasUserId) {
      const sections = groupByUserId(rows, formatAsset);
      return { summary: `Assets (${lines.length}): ${lines.join('; ')}.`, lines, sections };
    }
    return { summary: `Assets (${lines.length}): ${lines.join('; ')}.`, lines };
  }

  // Liabilities: description, amountOwed
  if ('amountOwed' in first && 'description' in first) {
    const rows = results as Record<string, unknown>[];
    const lines = rows.map(formatLiability);
    if (userMap && hasUserId) {
      const sections = groupByUserId(rows, formatLiability);
      return { summary: `Liabilities (${lines.length}): ${lines.join('; ')}.`, lines, sections };
    }
    return { summary: `Liabilities (${lines.length}): ${lines.join('; ')}.`, lines };
  }

  return null;
}

const SUMMARY_SYSTEM = `You are a helpful assistant. The user asked a question about the database. You will receive the question, the query results (JSON), and optionally "Resolved users" (userId -> full name), "Resolved counties" (id -> county name), "Resolved circuits", "Resolved states", "Resolved divisions", "Resolved role types" (id -> name), "Appointments" (upcoming), and/or "Assets" (affidavit assets for those users). Use Resolved users to state person full names. When any "Resolved ..." lookup is provided (counties, circuits, states, divisions, role types), use it to state names by ID (e.g. "Broward: $6,300" or "Petitioner Attorney: 12 users")—do not say "id 1" or "county with id 1"; use the resolved name. When appointment data is provided, list each appointment with date/time, status, and duration. When asset data is provided, list each asset with description and market value. Respond in 2-4 clear, concise sentences or a short list. Do not use markdown or code blocks. A person's full name comes from the users collection (firstName, lastName). employment.name is the EMPLOYER name, not the person's name. When results include __collection (employment, monthlyincome, assets, liabilities), group your answer by that.`;

export function createAdminRouter(
  auth: Pick<AuthMiddlewares, 'requireAuth' | 'requireAdmin' | 'requireAdminOrAiStaff'>
): express.Router {
  const router = express.Router();

  router.post('/admin/query', auth.requireAuth, auth.requireAdminOrAiStaff, async (req, res) => {
    const question =
      typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) {
      return sendErrorWithMessage(res, 'Missing question', 400);
    }

    const skipClarification = req.body?.skipClarification === true;

    const client = getOpenAIClient();
    if (!client) {
      return sendErrorWithMessage(
        res,
        'AI query service is not configured (missing OPENAI_API_KEY)',
        503
      );
    }

    try {
      // Step 2: Check ambiguity (skip when user is answering a clarification—prevents infinite loop)
      if (!skipClarification) {
        const clarification = await checkAmbiguity(client, question);
        if (clarification) {
          return res.json({ clarification, summary: null, count: 0, results: [] });
        }
      }

      // Step 2b: ID enrichment — resolve county/state/user names in the question to IDs
      let enrichment: Awaited<ReturnType<typeof enrichQuestionWithIds>>;
      try {
        enrichment = await enrichQuestionWithIds(question);
      } catch {
        enrichment = { promptSnippet: '' };
      }

      // Step 3: Retrieve RAG examples (LangChain)
      let ragContext = '';
      try {
        const examples = await retrieveSimilarExamples(question);
        if (examples.length > 0) {
          ragContext =
            '\n\nSimilar questions and their queries (follow this style):\n' +
            examples
              .map(
                (ex) =>
                  `Question: ${ex.question}\nQuery: ${JSON.stringify(ex.query)}\nExample summary: ${ex.result_summary}`
              )
              .join('\n---\n');
        }
      } catch (ragErr) {
        // If RAG fails (e.g. no OPENAI_API_KEY for embeddings), continue without examples
      }

      // Step 4: Generate Mongo query — use schema + relationship graph + RAG + enrichment
      const schemaText = getSchemaForPrompt();
      const relationshipText = getRelationshipGraphText();
      const systemContent = `${schemaText}\n\n${relationshipText}${ragContext}${enrichment.promptSnippet}\n\nOutput only by calling the query_mongodb tool. Use type "find" for simple filters; use type "aggregate" for averages, counts, or grouping. When the message above gives you a resolved countyId, stateId, or userId, use that exact value in your filter or pipeline. Do not explain.`;

      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: question },
        ],
        tools: [QUERY_TOOL],
        tool_choice: { type: 'function', function: { name: 'query_mongodb' } },
        max_tokens: 500,
      });

      const choice = completion.choices?.[0];
      const toolCall = choice?.message?.tool_calls?.[0];
      if (!toolCall || toolCall.function?.name !== 'query_mongodb') {
        return res.status(400).json({
          error: 'Could not generate a query. Try rephrasing.',
          raw: choice?.message?.content ?? null,
        });
      }

      let args: {
        type?: string;
        collection?: string;
        filter?: Record<string, unknown>;
        projection?: Record<string, unknown>;
        limit?: number;
        pipeline?: unknown[];
      };
      try {
        args = JSON.parse(toolCall.function.arguments ?? '{}');
      } catch {
        return res.status(400).json({ error: 'Invalid query from AI.' });
      }

      // Optionally inject resolved IDs into filter when the LLM did not set them
      const filter = (args.filter && typeof args.filter === 'object' ? args.filter : {}) as Record<string, unknown>;
      const col = (args.collection ?? '').trim();
      if (enrichment.countyId != null && col === 'case' && filter.countyId == null) {
        filter.countyId = enrichment.countyId;
        args.filter = filter;
      }
      // For affidavit collections, always use resolved userId(s) (LLM may output placeholder or username string)
      const affidavitCols = ['monthlyincome', 'assets', 'employment', 'liabilities'];
      if (enrichment.userIds?.length && affidavitCols.includes(col)) {
        try {
          const oids = enrichment.userIds
            .map((id) => {
              try {
                return new mongoose.Types.ObjectId(id);
              } catch {
                return null;
              }
            })
            .filter((o): o is mongoose.Types.ObjectId => o != null);
          if (oids.length === 1) {
            filter.userId = oids[0];
          } else if (oids.length > 1) {
            filter.userId = { $in: oids };
          }
          args.filter = filter;
        } catch {
          // ignore
        }
      }
      // For case queries involving user(s), always use resolved ObjectId(s)
      if (enrichment.userIds?.length && col === 'case') {
        try {
          const oids = enrichment.userIds
            .map((id) => {
              try {
                return new mongoose.Types.ObjectId(id);
              } catch {
                return null;
              }
            })
            .filter((o): o is mongoose.Types.ObjectId => o != null);
          if (oids.length > 0) {
            const userCaseFilter =
              oids.length === 1
                ? {
                    $or: [
                      { petitionerId: oids[0] },
                      { respondentId: oids[0] },
                      { petitionerAttId: oids[0] },
                      { respondentAttId: oids[0] },
                      { legalAssistantId: oids[0] },
                    ],
                  }
                : {
                    $or: [
                      { petitionerId: { $in: oids } },
                      { respondentId: { $in: oids } },
                      { petitionerAttId: { $in: oids } },
                      { respondentAttId: { $in: oids } },
                      { legalAssistantId: { $in: oids } },
                    ],
                  };
            args.filter = userCaseFilter;
            // Include user ID fields in projection so formatCaseListSummary can group by involved user
            const caseUserFields = {
              petitionerId: 1,
              respondentId: 1,
              petitionerAttId: 1,
              respondentAttId: 1,
              legalAssistantId: 1,
            };
            if (args.projection && typeof args.projection === 'object') {
              Object.assign(args.projection, caseUserFields);
            } else {
              args.projection = { caseNumber: 1, division: 1, _id: 1, ...caseUserFields };
            }
          }
        } catch {
          // ignore
        }
      }

      const queryType = (args.type ?? 'find') as string;
      let results: unknown[];
      let queryCollection: string;

      if (queryType === 'aggregate' && Array.isArray(args.pipeline)) {
        if (enrichment.countyId != null) {
          injectCountyIdIntoCaseLookup(args.pipeline, enrichment.countyId);
        }
        // Enforce "top N" / "N counties" from the question so we return N results
        const topN = parseTopNFromQuestion(question);
        const pipeline =
          topN != null ? ensurePipelineLimitForTopN(args.pipeline, topN) : args.pipeline;
        // Step 5: Validate aggregate
        const sanitized = validateAndSanitizeAggregate({
          collection: args.collection ?? '',
          pipeline,
        });
        // Step 6: Run aggregate
        results = await runMongoAggregate(sanitized);
        queryCollection = sanitized.collection;
      } else {
        // Step 5: Validate find
        const sanitized = validateAndSanitizeQuery({
          collection: args.collection ?? '',
          filter: args.filter ?? {},
          projection: args.projection,
          limit: args.limit,
        });
        // Step 6: Run find
        results = await runMongoFind(sanitized);
        queryCollection = sanitized.collection;
      }

      const count = results.length;
      const userIds = getUserIdsForLookup(results, queryCollection);
      let resolvedUsers = await resolveUsers(userIds);
      // Case queries: if no users were extracted (e.g. collection name casing) but we have enrichment.userIds, resolve those for section titles
      if (
        resolvedUsers.length === 0 &&
        enrichment?.userIds?.length &&
        results.length > 0
      ) {
        const first = results[0] as Record<string, unknown> | undefined;
        if (first && typeof first.caseNumber === 'string') {
          const enrichmentOids = enrichment.userIds
            .map((id) => {
              try {
                return new mongoose.Types.ObjectId(id);
              } catch {
                return null;
              }
            })
            .filter((o): o is mongoose.Types.ObjectId => o != null);
          if (enrichmentOids.length > 0) resolvedUsers = await resolveUsers(enrichmentOids);
        }
      }

      const questionLower = question.toLowerCase();
      const asksAboutCounties = /\bcount(y|ies)\b/.test(questionLower);
      const asksAboutCircuits = /\bcircuit(s)?\b/.test(questionLower);
      const asksAboutStates = /\bstate(s)?\b/.test(questionLower);
      const asksAboutDivisions = /\bdivision(s)?\b/.test(questionLower);
      const asksAboutRoles = /\b(role|petitioner|respondent|attorney|admin|legal\s+assistant)s?\b/.test(questionLower);

      let countyIds = asksAboutCounties ? getCountyIdsFromResults(results) : [];
      if (enrichment?.countyId != null && !countyIds.includes(enrichment.countyId)) {
        countyIds = [...countyIds, enrichment.countyId];
      }
      const circuitIds = asksAboutCircuits ? getCircuitIdsFromResults(results) : [];
      const stateIds = asksAboutStates ? getStateIdsFromResults(results) : [];
      const divisionIds = asksAboutDivisions ? getDivisionIdsFromResults(results) : [];
      const roleTypeIds = asksAboutRoles ? getRoleTypeIdsFromResults(results) : [];

      const [resolvedCounties, resolvedCircuits, resolvedStates, resolvedDivisions, resolvedRoleTypes] =
        await Promise.all([
          countyIds.length > 0 ? resolveCounties(countyIds) : Promise.resolve([]),
          circuitIds.length > 0 ? resolveCircuits(circuitIds) : Promise.resolve([]),
          stateIds.length > 0 ? resolveStates(stateIds) : Promise.resolve([]),
          divisionIds.length > 0 ? resolveDivisions(divisionIds) : Promise.resolve([]),
          roleTypeIds.length > 0 ? resolveRoleTypes(roleTypeIds) : Promise.resolve([]),
        ]);

      let appointmentsForUsers: unknown[] = [];
      let assetsForUsers: unknown[] = [];
      if (/appointment/.test(questionLower) && userIds.length > 0) {
        appointmentsForUsers = await fetchAppointmentsForUsers(userIds);
      }
      if (/asset/.test(questionLower) && userIds.length > 0) {
        assetsForUsers = await fetchAssetsForUsers(userIds);
      }

      // Step 7: Optional LLM summary (only if result set is large)
      let summary: string;
      let summaryList: string[] | undefined;
      let summarySections: { title: string; items: string[] }[] | undefined;
      if (count > RESULT_SIZE_THRESHOLD_FOR_SUMMARY) {
        const resultsJson = JSON.stringify(results);
        const truncated =
          resultsJson.length > MAX_RESULT_JSON_CHARS
            ? resultsJson.slice(0, MAX_RESULT_JSON_CHARS) + ' ... (truncated)'
            : resultsJson;
        let userContent = `Question: ${question}\n\nResults (${count} document(s)):\n${truncated}`;
        if (resolvedUsers.length > 0) {
          const fullNames = resolvedUsers.map(
            (u) =>
              `${u._id}: ${[u.firstName, u.lastName].filter(Boolean).join(' ') || u.uname || '—'}`
          );
          userContent += `\n\nResolved users:\n${fullNames.join('\n')}`;
        }
        if (resolvedCounties.length > 0) {
          const countyLines = resolvedCounties.map((c) => `${c.id} = ${c.name}`);
          userContent += `\n\nResolved counties (use these names when results contain _id or countyId):\n${countyLines.join('\n')}`;
        }
        if (resolvedCircuits.length > 0) {
          const lines = resolvedCircuits.map((c) => `${c.id} = ${c.name}`);
          userContent += `\n\nResolved circuits (id -> name):\n${lines.join('\n')}`;
        }
        if (resolvedStates.length > 0) {
          const lines = resolvedStates.map((s) => `${s.id} = ${s.name}`);
          userContent += `\n\nResolved states (id -> name):\n${lines.join('\n')}`;
        }
        if (resolvedDivisions.length > 0) {
          const lines = resolvedDivisions.map((d) => `${d.id} = ${d.name}`);
          userContent += `\n\nResolved divisions (id -> name):\n${lines.join('\n')}`;
        }
        if (resolvedRoleTypes.length > 0) {
          const lines = resolvedRoleTypes.map((r) => `${r.id} = ${r.name}`);
          userContent += `\n\nResolved role types (id -> name, e.g. 1=Petitioner, 3=Petitioner Attorney):\n${lines.join('\n')}`;
        }
        if (appointmentsForUsers.length > 0) {
          userContent += `\n\nAppointments (upcoming):\n${JSON.stringify(appointmentsForUsers)}`;
        } else if (/appointment/.test(questionLower) && userIds.length > 0) {
          userContent += '\n\nAppointments: none upcoming found for these users.';
        }
        if (assetsForUsers.length > 0) {
          userContent += `\n\nAssets:\n${JSON.stringify(assetsForUsers)}`;
        } else if (/asset/.test(questionLower) && userIds.length > 0) {
          userContent += '\n\nAssets: none found for these users.';
        }
        const summaryRes = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SUMMARY_SYSTEM },
            { role: 'user', content: userContent },
          ],
          max_tokens: 300,
        });
        summary =
          summaryRes.choices?.[0]?.message?.content?.trim() ??
          (count === 0 ? 'No documents match your question.' : `${count} document(s) found.`);
      } else {
        if (count === 0) {
          summary = 'No documents match your question.';
        } else {
          const formatted = formatSmallResultSummary(
            results,
            resolvedCounties,
            resolvedCircuits,
            resolvedStates,
            resolvedDivisions,
            resolvedRoleTypes
          );
          const personFormatted = formatPersonListSummary(results);
          const caseFormatted = formatCaseListSummary(results, resolvedUsers, enrichment?.userIds);
          const affidavitFormatted = formatAffidavitListSummary(results, resolvedUsers);
          if (formatted) {
            summary = formatted.summary;
            summaryList = formatted.lines;
          } else if (affidavitFormatted) {
            summary = affidavitFormatted.summary;
            if (affidavitFormatted.sections?.length) {
              summarySections = affidavitFormatted.sections;
              summaryList = [];
            } else {
              summaryList = affidavitFormatted.lines;
            }
          } else if (caseFormatted && typeof caseFormatted === 'object' && caseFormatted.sections?.length) {
            summary = caseFormatted.summary;
            summarySections = caseFormatted.sections;
            summaryList = [];
          } else {
            summary =
              personFormatted ?? (typeof caseFormatted === 'string' ? caseFormatted : null) ?? `${count} document(s) found. Review the results below.`;
          }
        }
      }

      res.json({
        summary,
        ...(summaryList != null && { summaryList }),
        ...(summarySections != null && summarySections.length > 0 && { summarySections }),
        count,
        results,
      });
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err?.status === 429 || err?.status === 402) {
        return sendErrorWithMessage(
          res,
          'AI quota exceeded. Check OpenAI billing.',
          err.status
        );
      }
      if (
        err?.message?.includes('Invalid collection') ||
        err?.message?.includes('Forbidden') ||
        err?.message?.includes('forbidden')
      ) {
        return res.status(400).json({ error: err.message });
      }
      sendError(res, e);
    }
  });

  return router;
}
