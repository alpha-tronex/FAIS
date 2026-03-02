import mongoose from 'mongoose';
import express from 'express';
import { getOpenAIClient } from '../lib/openai.js';
import { MONGO_QUERY_SCHEMA_DESCRIPTION } from '../lib/mongo-query-schema.js';
import { validateAndSanitizeQuery, runMongoFind } from '../lib/mongo-query-runner.js';
import { sendError, sendErrorWithMessage } from './error.js';
import type { AuthMiddlewares } from './middleware.js';

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

/** Get user ObjectIds from results: from userId field, from _id when collection is users, or from case user fields when collection is case. */
function getUserIdsForLookup(
  results: unknown[],
  collection: string
): mongoose.Types.ObjectId[] {
  const ids = new Set<string>();
  const isUsersCollection = collection === 'users';
  const isCaseCollection = collection === 'case';
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

/** Fetch upcoming appointments for the given user IDs (as petitioner, attorney, or legal assistant). */
async function fetchAppointmentsForUsers(
  userIds: mongoose.Types.ObjectId[]
): Promise<unknown[]> {
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

/** Fetch assets for the given user IDs (affidavit assets, keyed by userId). */
async function fetchAssetsForUsers(
  userIds: mongoose.Types.ObjectId[]
): Promise<unknown[]> {
  if (userIds.length === 0) return [];
  const docs = await mongoose.connection
    .collection('assets')
    .find({ userId: { $in: userIds } })
    .project({ description: 1, marketValue: 1, assetsTypeId: 1 })
    .toArray();
  return docs as unknown[];
}

const QUERY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'query_mongodb',
    description:
      'Run a read-only MongoDB find query. Use only allowed collections and safe filter/projection.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        filter: { type: 'object', description: 'MongoDB filter' },
        projection: { type: 'object', description: 'Optional projection' },
        limit: { type: 'number', description: 'Max docs to return (1-500)' },
      },
      required: ['collection', 'filter'],
    },
  },
};

/** If the question asks for a specific user role, return the roleTypeId to enforce on users queries (1–6). */
function getRequiredRoleTypeIdFromQuestion(question: string): number | null {
  const q = question.toLowerCase();
  // Check compound roles first so "petitioner attorneys" → 3, not 1
  if (/\bpetitioner\s+attorney(s)?\b/.test(q)) return 3;
  if (/\brespondent\s+attorney(s)?\b/.test(q)) return 4;
  if (/\b(administrator|admin)s?\b/.test(q) && !q.includes('attorney')) return 5;
  if (/\blegal\s+assistant(s)?\b/.test(q)) return 6;
  const asksPetitioners = q.includes('petitioner');
  const asksRespondents = q.includes('respondent');
  if (asksPetitioners && !asksRespondents) return 1;
  if (asksRespondents && !asksPetitioners) return 2;
  return null;
}

/** Resolve a county name mentioned in the question to lookup_counties id. Returns null if none or ambiguous. */
async function resolveCountyFromQuestion(
  question: string
): Promise<{ id: number; name: string } | null> {
  const counties = await mongoose.connection
    .collection('lookup_counties')
    .find({})
    .project({ id: 1, name: 1 })
    .toArray();
  const q = question.toLowerCase().trim();
  const matches: { id: number; name: string }[] = [];
  for (const row of counties as { id?: number; name?: string }[]) {
    const name = row.name?.trim();
    if (!name || typeof row.id !== 'number') continue;
    const nameLower = name.toLowerCase();
    const withCounty = `${nameLower} county`;
    if (q.includes(nameLower) || q.includes(withCounty)) {
      matches.push({ id: row.id, name });
    }
  }
  if (matches.length !== 1) return null;
  return matches[0]!;
}

export function createAdminRouter(
  auth: Pick<AuthMiddlewares, 'requireAuth' | 'requireAdmin'>
): express.Router {
  const router = express.Router();

  router.post('/admin/query', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const question =
      typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) {
      return sendErrorWithMessage(res, 'Missing question', 400);
    }

    const client = getOpenAIClient();
    if (!client) {
      return sendErrorWithMessage(
        res,
        'AI query service is not configured (missing OPENAI_API_KEY)',
        503
      );
    }

    try {
      const countyHint = await resolveCountyFromQuestion(question);
      const questionLower = question.toLowerCase();
      const asksForPartyInCounty =
        countyHint &&
        (questionLower.includes('petitioner') || questionLower.includes('respondent'));

      let results: unknown[];
      let queryCollection: string;

      if (asksForPartyInCounty && countyHint) {
        // Bypass LLM: run case query by county ourselves so we always get cases, not lookup_counties.
        const caseDocs = await mongoose.connection
          .collection('case')
          .find({ countyId: countyHint.id })
          .limit(500)
          .toArray();
        results = caseDocs as unknown[];
        queryCollection = 'case';
      } else {
        let systemContent = `${MONGO_QUERY_SCHEMA_DESCRIPTION}\n\nOutput only by calling the query_mongodb tool. Do not explain.`;
        if (countyHint) {
          systemContent += `\n\nCOUNTY ID FOR THIS QUESTION: The user asked about ${countyHint.name} county. You MUST query the case collection (not lookup_counties) with this filter: { "countyId": ${countyHint.id} }. That returns cases filed in ${countyHint.name}; petitionerId and respondentId on each case are the people. Do NOT query lookup_counties—that would return county names only, not petitioners or respondents.`;
        }

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
        if (
          !toolCall ||
          toolCall.function?.name !== 'query_mongodb'
        ) {
          return res.status(400).json({
            error: 'Could not generate a query. Try rephrasing.',
            raw: choice?.message?.content ?? null,
          });
        }

        let args: {
          collection?: string;
          filter?: Record<string, unknown>;
          projection?: Record<string, unknown>;
          limit?: number;
        };
        try {
          args = JSON.parse(toolCall.function.arguments ?? '{}');
        } catch {
          return res.status(400).json({ error: 'Invalid query from AI.' });
        }

        const sanitized = validateAndSanitizeQuery({
          collection: args.collection ?? '',
          filter: args.filter,
          projection: args.projection,
          limit: args.limit,
        });

        const requiredRole = getRequiredRoleTypeIdFromQuestion(question);

        // When the question asks for a specific role (e.g. "list all petitioner attorneys"), always query users
        // with that roleTypeId so we don't depend on the LLM choosing the right collection (e.g. it might query case and return parties).
        if (requiredRole != null) {
          const f = sanitized.collection === 'users' ? (sanitized.filter as Record<string, unknown>) : {};
          const baseFilter = Array.isArray(f.$and)
            ? { $and: [...(f.$and as object[]).filter((c) => (c as Record<string, unknown>).roleTypeId === undefined), { roleTypeId: requiredRole }] }
            : { ...f, roleTypeId: requiredRole };
          const userQuery = validateAndSanitizeQuery({
            collection: 'users',
            filter: baseFilter,
            projection: sanitized.collection === 'users' ? sanitized.projection : undefined,
            limit: sanitized.limit,
          });
          results = await runMongoFind(userQuery);
          queryCollection = 'users';
        } else {
          results = await runMongoFind(sanitized);
          queryCollection = sanitized.collection;
        }
      }

      const count = results.length;

      // User IDs for lookups: from userId in results, or from _id when the query was on users collection.
      const userIds = getUserIdsForLookup(results, queryCollection);
      const resolvedUsers = await resolveUsers(userIds);

      // If the question is about appointments or assets and we have user IDs, fetch related data.
      let appointmentsForUsers: unknown[] = [];
      let assetsForUsers: unknown[] = [];
      if (/appointment/.test(questionLower) && userIds.length > 0) {
        appointmentsForUsers = await fetchAppointmentsForUsers(userIds);
      }
      if (/asset/.test(questionLower) && userIds.length > 0) {
        assetsForUsers = await fetchAssetsForUsers(userIds);
      }

      // Summarize results in natural language for the admin.
      const resultsJson = JSON.stringify(results);
      const maxChars = 8000;
      const truncated =
        resultsJson.length > maxChars
          ? resultsJson.slice(0, maxChars) + ' ... (truncated)'
          : resultsJson;

      let userContent = `Question: ${question}\n\nResults (${count} document(s)):\n${truncated}`;
      if (resolvedUsers.length > 0) {
        const fullNames = resolvedUsers.map(
          (u) =>
            `${u._id}: ${[u.firstName, u.lastName].filter(Boolean).join(' ') || u.uname || '—'}`
        );
        userContent += `\n\nResolved users (from users collection; use these for person full names when results reference userId):\n${fullNames.join('\n')}`;
      }
      if (appointmentsForUsers.length > 0) {
        userContent += `\n\nAppointments (upcoming for these users; list these specifically with date/time and status):\n${JSON.stringify(appointmentsForUsers)}`;
      } else if (/appointment/.test(questionLower) && userIds.length > 0) {
        userContent += `\n\nAppointments: none upcoming found for these users.`;
      }
      if (assetsForUsers.length > 0) {
        userContent += `\n\nAssets (for these users; list each with description and market value):\n${JSON.stringify(assetsForUsers)}`;
      } else if (/asset/.test(questionLower) && userIds.length > 0) {
        userContent += `\n\nAssets: none found for these users.`;
      }

      const summaryCompletion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a helpful assistant. The user asked a question about the database. You will receive the question, the query results (JSON), and optionally "Resolved users" (userId -> full name), "Appointments" (upcoming), and/or "Assets" (affidavit assets for those users). Use Resolved users to state person full names. When appointment data is provided, list each appointment with date/time, status, and duration. When asset data is provided, list each asset with description and market value (e.g. "[Description]: $[marketValue]" or "Total: $X across N assets"). If "Assets: none found" is given, say the person has no assets on file. Do not say "information is not available" or "please clarify" when Assets or Appointments data is provided—use that data to give a specific answer. Respond in 2-4 clear, concise sentences or a short list. Do not use markdown or code blocks.

CRITICAL: A person's full name comes from the users collection (firstName, lastName). In the employment collection, "name" is the EMPLOYER or organization name (e.g. "McDonald's"), and "occupation" is the job title (e.g. "Manager"). Never report employment.name or employment.occupation as a person's full name. When "Resolved users" is provided, use it to give the person's full name. When "Appointments" or "Assets" is provided, give a specific answer from that data—list them or state there are none. When the question asks for "petitioners" (or "respondents", etc.) and the results are from the case collection, list only the people in that role: use petitionerId for petitioners, respondentId for respondents, petitionerAttId for petitioner attorneys, respondentAttId for respondent attorneys, legalAssistantId for legal assistants. Do not list other parties on the case.`,
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
        max_tokens: 300,
      });

      const summary =
        summaryCompletion.choices?.[0]?.message?.content?.trim() ??
        (count === 0 ? 'No documents match your question.' : `${count} document(s) found.`);

      res.json({ summary, count, results });
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
        err?.message?.includes('forbidden')
      ) {
        return res.status(400).json({ error: err.message });
      }
      sendError(res, e);
    }
  });

  return router;
}
