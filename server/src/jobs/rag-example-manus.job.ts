/**
 * Scheduled job: call Manus API to generate RAG (question, query, result_summary) examples,
 * validate them, and insert into MongoDB. Runs on a configurable cron (default weekly).
 * No n8n dependency; uses MANUS_API_KEY from env.
 */

import cron from 'node-cron';
import {
  hasDiscoveredSchema,
  refreshDiscoveredSchema,
  getSchemaForPrompt,
} from '../lib/ai-query-schema-discovery.js';
import { getRelationshipGraphText } from '../lib/ai-query-relationship-graph.js';
import { createTask, getTask, getAssistantTextFromOutputAsync } from '../lib/manus-api.js';
import { validateExampleQuery } from '../lib/ai-query-example-validation.js';
import { insertDynamicExample } from '../lib/ai-query-dynamic-examples.js';
import { invalidateRagCache } from '../lib/ai-query-rag.js';
import { log, logError } from '../lib/rag-manus-job-logger.js';
import type { AiQueryExample } from '../lib/ai-query-examples.js';

const POLL_INTERVAL_MS = 8000;
const MAX_WAIT_MS = 5 * 60 * 1000;

const RAG_MANUS_PROMPT = `Generate exactly 20 triples for a family-law admin dashboard. Each triple has:
1. question: a natural-language question an admin might ask (e.g. "List all petitioners", "Which counties have the most liabilities").
2. query: a MongoDB query as JSON in query_mongodb form. Use either { "type": "find", "collection": "<name>", "filter": {...}, "projection": {...}, "limit": <number> } or { "type": "aggregate", "collection": "<name>", "pipeline": [...] }. Only use collections listed in the schema section below.
3. result_summary: one short sentence describing the kind of result (e.g. "There are 12 petitioners.").

CRITICAL: Your entire response must be ONLY the JSON array—no intro sentence, no explanation, no markdown. Start with the character [ and end with ]. Do not write any text before the [ or after the final ].`;

/** Try to parse JSON; if it fails, try normalizing single-quoted keys to double-quoted. */
function tryParseJsonArray(candidate: string): unknown[] | null {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    const normalized = candidate.replace(/'(\w+)'\s*:/g, '"$1":');
    try {
      const parsed = JSON.parse(normalized) as unknown;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function parseTriplesFromAssistantText(text: string): AiQueryExample[] {
  const trimmed = text.trim();
  let working = trimmed;
  if (!trimmed.startsWith('[')) {
    const afterNewlineBracket = trimmed.search(/\n\s*\[/);
    if (afterNewlineBracket >= 0) {
      working = trimmed.slice(afterNewlineBracket).trim();
    } else {
      const firstBracket = trimmed.indexOf('[');
      if (firstBracket >= 0) {
        working = trimmed.slice(firstBracket);
      }
    }
  }
  let jsonStr = working;
  const codeBlock = working.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock && codeBlock[1]) {
    jsonStr = codeBlock[1].trim();
  } else {
    const bracketStarts: number[] = [];
    for (let i = 0; i < working.length; i++) {
      if (working[i] === '[') bracketStarts.push(i);
    }
    for (const startIdx of [...bracketStarts].reverse()) {
      let depth = 0;
      let endIdx = -1;
      for (let i = startIdx; i < working.length; i++) {
        const ch = working[i];
        if (ch === '[') depth++;
        else if (ch === ']') {
          depth--;
          if (depth === 0) endIdx = i;
        }
      }
      if (endIdx < 0) continue;
      const candidate = working.slice(startIdx, endIdx + 1);
      const parsed = tryParseJsonArray(candidate);
      if (
        parsed &&
        parsed.length > 0 &&
        typeof (parsed[0] as Record<string, unknown>)?.question === 'string'
      ) {
        jsonStr = candidate;
        break;
      }
    }
  }
  const arr = tryParseJsonArray(jsonStr);
  if (!arr) {
    const bracketCount = (working.match(/\[/g) || []).length;
    const snippet = trimmed.slice(0, 300).replace(/\n/g, ' ');
    const truncatedHint =
      trimmed.length < 200 && bracketCount === 0
        ? ' Output appears truncated (no [ found).'
        : '';
    logError(
      `No JSON array found. Response length=${trimmed.length} chars, bracketStarts=${bracketCount}.${truncatedHint} First 300 chars: ${snippet}`
    );
    throw new Error(`No JSON array found in assistant output. First 300 chars: ${snippet}`);
  }
  return arr.filter((item): item is AiQueryExample => {
    return (
      item != null &&
      typeof item === 'object' &&
      typeof (item as AiQueryExample).question === 'string' &&
      typeof (item as AiQueryExample).result_summary === 'string' &&
      (item as AiQueryExample).query != null &&
      typeof (item as AiQueryExample).query === 'object'
    );
  }) as AiQueryExample[];
}

/**
 * Run the RAG example generation once (Manus API + validate + insert).
 * Used by the cron job and by the one-off script.
 */
export async function runRagExampleManusJobOnce(): Promise<void> {
  if (!process.env.MANUS_API_KEY?.trim()) {
    log('[rag-example-manus] Skipped: MANUS_API_KEY not set');
    return;
  }
  if (!hasDiscoveredSchema()) {
    await refreshDiscoveredSchema();
  }
  const schema = getSchemaForPrompt();
  const relationshipGraph = getRelationshipGraphText();
  const fullPrompt = `${RAG_MANUS_PROMPT}\n\n## Schema and relationships (use these for collection/field names and $lookup):\n\n${schema}\n\n${relationshipGraph}`;

  const { task_id } = await createTask(fullPrompt);
  log(`[rag-example-manus] Created Manus task: ${task_id}`);

  // Brief delay so the task is available for GET
  await new Promise((r) => setTimeout(r, 3000));

  const deadline = Date.now() + MAX_WAIT_MS;
  let task = await getTask(task_id);
  while (task.status !== 'completed' && task.status !== 'failed' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    task = await getTask(task_id);
  }

  if (task.status === 'failed') {
    const msg = `Manus task failed: ${task.error || 'unknown'}`;
    logError(msg);
    throw new Error(msg);
  }
  if (task.status !== 'completed') {
    const msg = 'Manus task did not complete in time';
    logError(msg);
    throw new Error(msg);
  }

  const assistantText = await getAssistantTextFromOutputAsync(task.output);
  if (!assistantText) {
    logError('No assistant output in task');
    throw new Error('No assistant output in task');
  }

  let triples: AiQueryExample[];
  try {
    triples = parseTriplesFromAssistantText(assistantText);
  } catch (parseErr) {
    logError('Failed to parse task output as JSON', parseErr);
    throw parseErr;
  }

  let added = 0;
  for (const item of triples) {
    try {
      validateExampleQuery(item.query);
      await insertDynamicExample(item);
      added++;
    } catch {
      // skip invalid item
    }
  }
  invalidateRagCache();
  log(`[rag-example-manus] Added ${added}/${triples.length} examples`);
}

export function scheduleRagExampleManusJob(): void {
  const cronExpr = process.env.RAG_MANUS_CRON?.trim() || '0 3 * * 0';
  cron.schedule(cronExpr, async () => {
    try {
      await runRagExampleManusJobOnce();
    } catch (err) {
      logError('[rag-example-manus] Job failed', err);
    }
  });
}
