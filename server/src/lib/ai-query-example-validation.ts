/**
 * Shared validation for AI Query RAG examples (find or aggregate).
 * Used by admin route POST /admin/ai-query/examples and by the RAG Manus job.
 */

import type { ExampleQuery } from './ai-query-examples.js';
import {
  validateAndSanitizeQuery,
  validateAndSanitizeAggregate,
} from './mongo-query-runner.js';

/**
 * Validate a candidate example query (find or aggregate); throws if invalid.
 */
export function validateExampleQuery(query: unknown): void {
  const q = query as ExampleQuery;
  if (!q || typeof q !== 'object' || typeof q.type !== 'string' || typeof q.collection !== 'string') {
    throw new Error('Query must have type and collection');
  }
  const col = (q.collection ?? '').trim();
  if (q.type === 'find') {
    validateAndSanitizeQuery({
      collection: col,
      filter: (q as { filter?: Record<string, unknown> }).filter ?? {},
      projection: (q as { projection?: Record<string, unknown> }).projection,
      limit: (q as { limit?: number }).limit,
    });
  } else if (q.type === 'aggregate') {
    const pipeline = (q as { pipeline?: unknown[] }).pipeline;
    if (!Array.isArray(pipeline)) throw new Error('Aggregate query must have pipeline array');
    validateAndSanitizeAggregate({ collection: col, pipeline });
  } else {
    throw new Error('Query type must be find or aggregate');
  }
}
