/**
 * ID enrichment for AI Query: resolve entity mentions in the user question (county names,
 * state names, user names) to DB IDs and build a prompt snippet so the LLM uses correct IDs.
 */

import mongoose from 'mongoose';

export type EnrichmentResult = {
  countyId?: number;
  stateId?: number;
  /** Resolved user ObjectId (set when exactly one user is mentioned). */
  userId?: string;
  /** Resolved user ObjectIds (set when one or more users are mentioned; use for $in when length > 1). */
  userIds?: string[];
  promptSnippet: string;
};

/** Match county-like phrases: "in X county", "X county", "Broward", "Miami-Dade", etc. */
const COUNTY_PATTERNS = [
  /\b(in\s+)?([A-Za-z][A-Za-z\s\-']+?)\s+county\b/i,
  /\b(Broward|Miami-Dade|Palm Beach|Orange|Hillsborough|Pinellas|Duval|Lee|Polk|Brevard)\b/i,
];

/** Match state names or abbrevs: "Florida", "FL" */
const STATE_PATTERNS = [
  /\b(Florida|FL)\b/i,
  /\b(in\s+)?([A-Za-z][A-Za-z\s\-]+?)\s+state\b/i,
];

/** Match username patterns in questions */
const USER_PATTERNS = [
  /\b(?:for|user|username|involving)\s+([a-zA-Z0-9_.-]+)\b/i,
  /\bstress-(?:petitioner|respondent|pet-att|resp-att)-(\d+)\b/i,
];

/**
 * Find a county ID by name (case-insensitive, trim). Returns first match.
 */
async function resolveCountyByName(name: string): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const doc = await mongoose.connection
    .collection('lookup_counties')
    .findOne({
      $or: [
        { name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') } },
        { name: { $regex: new RegExp(`^${escapeRegex(trimmed)}\\s+County$`, 'i') } },
      ],
    });
  const d = doc as { id?: number } | null;
  if (d && typeof d.id === 'number') return d.id;
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find a state ID by name or abbrev (e.g. "Florida", "FL").
 */
async function resolveStateByNameOrAbbrev(nameOrAbbrev: string): Promise<number | null> {
  const trimmed = nameOrAbbrev.trim();
  if (!trimmed) return null;
  const doc = await mongoose.connection
    .collection('lookup_states')
    .findOne({
      $or: [
        { name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') } },
        { abbrev: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') } },
      ],
    });
  const d = doc as { id?: number } | null;
  if (d && typeof d.id === 'number') return d.id;
  return null;
}

/**
 * Find a user by uname (login name).
 */
async function resolveUserByUname(uname: string): Promise<string | null> {
  const trimmed = uname.trim();
  if (!trimmed) return null;
  const doc = await mongoose.connection
    .collection('users')
    .findOne({ uname: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') } });
  const d = doc as { _id?: mongoose.Types.ObjectId } | null;
  if (d && d._id) return d._id.toString();
  return null;
}

/**
 * Enrich the question: detect county, state, and user mentions; resolve to IDs;
 * build a prompt snippet to inject so the LLM uses the correct IDs.
 */
export async function enrichQuestionWithIds(question: string): Promise<EnrichmentResult> {
  const result: EnrichmentResult = { promptSnippet: '' };
  const lines: string[] = [];

  // Counties
  for (const re of COUNTY_PATTERNS) {
    const m = question.match(re);
    if (m) {
      const name = String(m[2] ?? m[1] ?? '').trim();
      if (name && name.length > 1) {
        const id = await resolveCountyByName(name);
        if (id != null) {
          result.countyId = id;
          lines.push(`Resolved: "${name}" (county) → countyId ${id}. Use countyId: ${id} in filters when the question refers to this county.`);
          break;
        }
      }
    }
  }

  // States
  for (const re of STATE_PATTERNS) {
    const m = question.match(re);
    if (m) {
      const name = (m[2] ?? m[1] ?? m[0]).trim();
      if (name && name.length >= 2) {
        const id = await resolveStateByNameOrAbbrev(name);
        if (id != null) {
          result.stateId = id;
          lines.push(`Resolved: "${name}" (state) → stateId ${id}. Use stateId: ${id} in filters when the question refers to this state.`);
          break;
        }
      }
    }
  }

  // User (uname) - find all stress-* usernames (e.g. "stress-petitioner-1 and stress-petitioner-2")
  const stressRegex = /\b(stress-(?:petitioner|respondent|pet-att|resp-att)-\d+)\b/gi;
  const stressMatches = [...question.matchAll(stressRegex)];
  const uniqueUnames = [...new Set(stressMatches.map((m) => m[1]!.toLowerCase()))];
  if (uniqueUnames.length > 0) {
    const resolvedIds: string[] = [];
    for (const uname of uniqueUnames) {
      const id = await resolveUserByUname(uname);
      if (id) resolvedIds.push(id);
    }
    if (resolvedIds.length > 0) {
      result.userIds = resolvedIds;
      result.userId = resolvedIds[0];
      if (resolvedIds.length === 1) {
        lines.push(`Resolved: user "${uniqueUnames[0]}" → userId ObjectId ${resolvedIds[0]}. Use this ObjectId in filters.`);
      } else {
        lines.push(
          `Resolved: ${resolvedIds.length} users (${uniqueUnames.join(', ')}) → userIds: [${resolvedIds.join(', ')}]. Use filter userId: { $in: [these ObjectIds] } for affidavit collections, or $or with petitionerId/respondentId etc. for case.`
        );
      }
    }
  }

  // If no stress user found, try other patterns (single user)
  if (!result.userIds?.length) {
    for (const re of USER_PATTERNS) {
      const m = question.match(re);
      if (m && m[1]) {
        const uname = m[1].trim();
        const id = await resolveUserByUname(uname);
        if (id) {
          result.userId = id;
          result.userIds = [id];
          lines.push(`Resolved: user "${uname}" → userId ObjectId ${id}. Use this ObjectId in filters.`);
          break;
        }
      }
    }
  }

  if (lines.length > 0) {
    result.promptSnippet = '\n\n' + lines.join(' ');
  }

  return result;
}
