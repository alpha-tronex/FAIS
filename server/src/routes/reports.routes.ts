import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { User } from '../models.js';
import { getAboutUserSummary, runReport, type ReportCriteria, type ReportRow } from '../lib/report-runner.js';
import { sendError, sendErrorWithMessage } from './error.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';

/** Read at request time so dotenv.config() in index.ts has already run. Support OPENAI_API_KEY or OPENAI_KEY. */
function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_KEY?.trim();
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

const STRUCTURED_SYSTEM = `You must output only valid JSON with exactly these keys: roleType, incomeMin, incomeMax, filterByUsername, filterByCounty.
- roleType: string, one of "respondent" or "petitioner" (who to filter: the respondent or the petitioner on each case).
- incomeMin: number or null (minimum gross annual income; use null if not specified).
- incomeMax: number or null (maximum gross annual income; use null if not specified).
- filterByUsername: string or null. If the user asks about a specific user (e.g. "tell me about user admin", "about user john"), set this to the username only (e.g. "admin", "john") and set roleType, incomeMin, incomeMax, filterByCounty to null. Otherwise set filterByUsername to null.
- filterByCounty: string or null. If the user asks for cases in a specific county (e.g. "petitioners in Hillsborough county", "respondents in Miami-Dade", "cases in Escambia"), set this to the county name only (e.g. "Hillsborough", "Miami-Dade", "Escambia"). Otherwise set filterByCounty to null.
If the user asks for "under 50K" or "less than 50000" or "making less than 50K/year", set incomeMax to 50000 and roleType to "respondent" unless they clearly mean petitioner, and filterByUsername to null.
If they ask for "over 100K", set incomeMin to 100000. Output no other keys and no markdown or explanation.`;

const NATURAL_SYSTEM = `You must output only valid JSON. Allowed keys: reportType, roleType, incomeMin, incomeMax, numChildrenMin, numChildrenMax, filterByUsername, filterByCounty.
- reportType: string, one of "income_filter" or "children_filter" or "income_and_children" or "county_filter".
- roleType: "respondent" or "petitioner" (which party to report on).
- incomeMin, incomeMax: number or null (gross annual income range).
- numChildrenMin, numChildrenMax: number or null (filter cases by number of children).
- filterByUsername: string or null. If the user asks about a specific user (e.g. "tell me about user admin", "about user john"), set this to the username only and set all other keys to null. Otherwise set filterByUsername to null.
- filterByCounty: string or null. If the user asks for cases in a specific county (e.g. "petitioners in Hillsborough county", "respondents in Miami-Dade", "cases in Escambia"), set this to the county name only (e.g. "Hillsborough", "Miami-Dade", "Escambia"). Otherwise set filterByCounty to null.
Interpret the user's request and set the appropriate fields. For "respondents under 50K" use reportType "income_filter", roleType "respondent", incomeMax 50000, filterByUsername null, filterByCounty null.
For "cases with 3 or more children" use reportType "children_filter", numChildrenMin 3. For "petitioners in Hillsborough county" use reportType "county_filter", roleType "petitioner", filterByCounty "Hillsborough". Output no other keys and no markdown or explanation.`;

type StructuredParams = { roleType: string; incomeMin: number | null; incomeMax: number | null; filterByUsername: string | null; filterByCounty: string | null };
type NaturalParams = {
  reportType?: string;
  roleType?: string;
  incomeMin?: number | null;
  incomeMax?: number | null;
  numChildrenMin?: number | null;
  numChildrenMax?: number | null;
  filterByUsername?: string | null;
  filterByCounty?: string | null;
};

function parseStructuredResponse(text: string): StructuredParams | null {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const filterByUsername = typeof obj.filterByUsername === 'string' && obj.filterByUsername.trim() ? obj.filterByUsername.trim() : null;
    const filterByCounty = typeof obj.filterByCounty === 'string' && obj.filterByCounty.trim() ? obj.filterByCounty.trim() : null;
    const roleType = typeof obj.roleType === 'string' ? obj.roleType : 'respondent';
    const incomeMin = typeof obj.incomeMin === 'number' && Number.isFinite(obj.incomeMin) ? obj.incomeMin : obj.incomeMin === null ? null : null;
    const incomeMax = typeof obj.incomeMax === 'number' && Number.isFinite(obj.incomeMax) ? obj.incomeMax : obj.incomeMax === null ? null : null;
    return {
      roleType: roleType === 'petitioner' ? 'petitioner' : 'respondent',
      incomeMin: incomeMin ?? null,
      incomeMax: incomeMax ?? null,
      filterByUsername,
      filterByCounty,
    };
  } catch {
    return null;
  }
}

function parseNaturalResponse(text: string): NaturalParams | null {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const filterByUsername = typeof obj.filterByUsername === 'string' && obj.filterByUsername.trim() ? obj.filterByUsername.trim() : null;
    const filterByCounty = typeof obj.filterByCounty === 'string' && obj.filterByCounty.trim() ? obj.filterByCounty.trim() : null;
    return {
      reportType: typeof obj.reportType === 'string' ? obj.reportType : 'income_filter',
      roleType: typeof obj.roleType === 'string' && (obj.roleType === 'petitioner' || obj.roleType === 'respondent') ? obj.roleType : 'respondent',
      incomeMin: typeof obj.incomeMin === 'number' && Number.isFinite(obj.incomeMin) ? obj.incomeMin : obj.incomeMin === null ? null : null,
      incomeMax: typeof obj.incomeMax === 'number' && Number.isFinite(obj.incomeMax) ? obj.incomeMax : obj.incomeMax === null ? null : null,
      numChildrenMin: typeof obj.numChildrenMin === 'number' && Number.isFinite(obj.numChildrenMin) ? obj.numChildrenMin : obj.numChildrenMin === null ? null : null,
      numChildrenMax: typeof obj.numChildrenMax === 'number' && Number.isFinite(obj.numChildrenMax) ? obj.numChildrenMax : obj.numChildrenMax === null ? null : null,
      filterByUsername,
      filterByCounty,
    };
  } catch {
    return null;
  }
}

function toCriteriaStructured(p: StructuredParams, countyId?: number | null): ReportCriteria {
  const incomeMin = p.incomeMin != null ? Math.max(0, Math.min(10_000_000, p.incomeMin)) : null;
  const incomeMax = p.incomeMax != null ? Math.max(0, Math.min(10_000_000, p.incomeMax)) : null;
  return {
    roleType: p.roleType === 'petitioner' ? 'petitioner' : 'respondent',
    incomeMin: incomeMin ?? undefined,
    incomeMax: incomeMax ?? undefined,
    countyId: countyId ?? undefined,
  };
}

function toCriteriaNatural(p: NaturalParams, countyId?: number | null): ReportCriteria {
  const roleType = (p.roleType === 'petitioner' ? 'petitioner' : 'respondent') as 'respondent' | 'petitioner';
  const incomeMin = p.incomeMin != null ? Math.max(0, Math.min(10_000_000, p.incomeMin)) : undefined;
  const incomeMax = p.incomeMax != null ? Math.max(0, Math.min(10_000_000, p.incomeMax)) : undefined;
  const numChildrenMin = p.numChildrenMin != null && Number.isFinite(p.numChildrenMin) ? p.numChildrenMin : undefined;
  const numChildrenMax = p.numChildrenMax != null && Number.isFinite(p.numChildrenMax) ? p.numChildrenMax : undefined;
  return {
    roleType,
    incomeMin: incomeMin ?? undefined,
    incomeMax: incomeMax ?? undefined,
    numChildrenMin: numChildrenMin ?? undefined,
    numChildrenMax: numChildrenMax ?? undefined,
    countyId: countyId ?? undefined,
  };
}

/** Resolve username (uname) to user _id string, or null if not found. */
async function resolveUsername(uname: string): Promise<string | null> {
  const user = await User.findOne({ uname: uname.trim() }).select('_id').lean();
  return user ? String(user._id) : null;
}

/** Resolve county name (case-insensitive) to county id from lookup_counties, or null if not found. */
async function resolveCountyName(countyName: string): Promise<number | null> {
  const normalized = countyName.trim();
  if (!normalized) return null;
  const rows = await mongoose.connection
    .collection('lookup_counties')
    .find({})
    .project({ id: 1, name: 1 })
    .toArray();
  const lower = normalized.toLowerCase();
  const match = (rows as { id?: unknown; name?: string }[]).find(
    (r) => r?.name && String(r.name).trim().toLowerCase() === lower
  );
  const id = match && typeof match.id === 'number' && Number.isFinite(match.id) ? match.id : Number(match?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function callLLM(client: OpenAI, system: string, userPrompt: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt || 'List respondents with income under 50K.' },
    ],
    max_tokens: 256,
  });
  const content = completion.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

async function generateNarrative(client: OpenAI, rows: ReportRow[], criteria: ReportCriteria): Promise<string> {
  if (rows.length === 0) {
    return 'No cases match the requested criteria.';
  }
  const summary = JSON.stringify(
    { count: rows.length, sample: rows.slice(0, 5).map((r) => ({ caseNumber: r.caseNumber, partyName: r.partyName, grossAnnualIncome: r.grossAnnualIncome })) },
    null,
    0
  );
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Summarize the report in one or two short sentences. Be factual and concise. Output only the summary, no preamble.',
      },
      { role: 'user', content: `Report criteria: ${JSON.stringify(criteria)}. Results: ${summary}.` },
    ],
    max_tokens: 150,
  });
  const content = completion.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

export function createReportsRouter(
  auth: Pick<AuthMiddlewares, 'requireAuth' | 'requireReportAccess'>
): express.Router {
  const router = express.Router();

  router.post('/reports/query-structured', auth.requireAuth, auth.requireReportAccess, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';

    let client = getOpenAIClient();
    if (!client) {
      const _routeDir = path.dirname(fileURLToPath(import.meta.url));
      const serverEnvPath = path.join(_routeDir, '..', '..', '.env');
      dotenv.config({ path: serverEnvPath });
      client = getOpenAIClient();
    }
    if (!client) {
      return sendErrorWithMessage(res, 'AI report service is not configured (missing OPENAI_API_KEY)', 503);
    }

    try {
      const raw = await callLLM(client, STRUCTURED_SYSTEM, prompt || 'Show all respondents making less than 50K per year.');
      const params = parseStructuredResponse(raw);
      if (!params) {
        return res.status(400).json({ error: 'Could not parse the request. Try rephrasing your prompt.' });
      }
      let filterUserId: string | undefined = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      if (!filterUserId && params.filterByUsername) {
        const resolved = await resolveUsername(params.filterByUsername);
        if (!resolved) {
          return res.status(400).json({ error: `User "${params.filterByUsername}" not found.` });
        }
        filterUserId = resolved;
      }
      if (filterUserId && params.filterByUsername && !params.filterByCounty && params.incomeMin == null && params.incomeMax == null) {
        const aboutSummary = await getAboutUserSummary(authPayload, filterUserId);
        if (aboutSummary) {
          return res.json({ rows: [], narrative: null, aboutUserSummary: { bullets: aboutSummary.bullets } });
        }
        return res.json({ rows: [], narrative: 'No case found for that user.', aboutUserSummary: null });
      }
      let countyId: number | null = null;
      if (params.filterByCounty) {
        countyId = await resolveCountyName(params.filterByCounty);
        if (countyId == null) {
          return res.status(400).json({ error: `County "${params.filterByCounty}" not found.` });
        }
      }
      const criteria = toCriteriaStructured(params, countyId);
      const rows = await runReport(authPayload, criteria, { filterUserId: filterUserId || null });
      let narrative: string | undefined;
      try {
        narrative = await generateNarrative(client, rows, criteria);
      } catch {
        narrative = `${rows.length} case(s) match.`;
      }
      res.json({ rows, narrative });
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err?.status === 429 || err?.status === 402) {
        return sendErrorWithMessage(
          res,
          'AI report quota exceeded. Check your OpenAI plan and billing at https://platform.openai.com/account/billing',
          err.status
        );
      }
      sendError(res, e);
    }
  });

  router.post('/reports/query-natural', auth.requireAuth, auth.requireReportAccess, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';

    let client = getOpenAIClient();
    if (!client) {
      const _routeDir = path.dirname(fileURLToPath(import.meta.url));
      dotenv.config({ path: path.join(_routeDir, '..', '..', '.env') });
      client = getOpenAIClient();
    }
    if (!client) {
      return sendErrorWithMessage(res, 'AI report service is not configured (missing OPENAI_API_KEY)', 503);
    }

    try {
      const raw = await callLLM(client, NATURAL_SYSTEM, prompt || 'Show all respondents making less than 50K per year.');
      const params = parseNaturalResponse(raw);
      if (!params) {
        return res.status(400).json({ error: 'Could not parse the request. Try rephrasing your prompt.' });
      }
      let filterUserId: string | undefined = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      if (!filterUserId && params.filterByUsername) {
        const resolved = await resolveUsername(params.filterByUsername);
        if (!resolved) {
          return res.status(400).json({ error: `User "${params.filterByUsername}" not found.` });
        }
        filterUserId = resolved;
      }
      const onlyAboutUser =
        filterUserId &&
        params.filterByUsername &&
        !params.filterByCounty &&
        params.incomeMin == null &&
        params.incomeMax == null &&
        params.numChildrenMin == null &&
        params.numChildrenMax == null;
      if (onlyAboutUser && filterUserId) {
        const aboutSummary = await getAboutUserSummary(authPayload, filterUserId);
        if (aboutSummary) {
          return res.json({ rows: [], narrative: null, aboutUserSummary: { bullets: aboutSummary.bullets } });
        }
        return res.json({ rows: [], narrative: 'No case found for that user.', aboutUserSummary: null });
      }
      let countyId: number | null = null;
      if (params.filterByCounty) {
        countyId = await resolveCountyName(params.filterByCounty);
        if (countyId == null) {
          return res.status(400).json({ error: `County "${params.filterByCounty}" not found.` });
        }
      }
      const criteria = toCriteriaNatural(params, countyId);
      const rows = await runReport(authPayload, criteria, { filterUserId: filterUserId || null });
      let narrative: string | undefined;
      try {
        narrative = await generateNarrative(client, rows, criteria);
      } catch {
        narrative = `${rows.length} case(s) match.`;
      }
      res.json({ rows, narrative });
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err?.status === 429 || err?.status === 402) {
        return sendErrorWithMessage(
          res,
          'AI report quota exceeded. Check your OpenAI plan and billing at https://platform.openai.com/account/billing',
          err.status
        );
      }
      sendError(res, e);
    }
  });

  return router;
}
