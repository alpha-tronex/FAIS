import mongoose from 'mongoose';
import { ALLOWED_COLLECTIONS, type AllowedCollection } from './mongo-query-schema.js';

const FORBIDDEN_OPERATORS = ['$where', '$function', '$accumulator', '$eval', '$jsonSchema'];

const ALLOWED_QUERY_OPERATORS = new Set([
  '$and',
  '$or',
  '$nor',
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$exists',
  '$regex',
  '$options',
  '$elemMatch',
]);

/** Allowed aggregation pipeline stages (read-only, safe). $lookup/$unwind allow joins for queries like "counties with most liabilities". */
export const ALLOWED_AGGREGATION_STAGES = [
  '$match',
  '$group',
  '$sort',
  '$limit',
  '$project',
  '$count',
  '$lookup',
  '$unwind',
] as const;

const ALLOWED_AGGREGATION_STAGES_SET = new Set<string>(ALLOWED_AGGREGATION_STAGES);

function hasForbiddenOperator(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  const rec = obj as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (FORBIDDEN_OPERATORS.includes(key)) return true;
    if (key.startsWith('$') && !ALLOWED_QUERY_OPERATORS.has(key)) return true;
    if (hasForbiddenOperator(rec[key])) return true;
  }
  return false;
}

/**
 * For aggregation stage content we only reject operators that can run arbitrary code.
 * $group / $project etc. use $avg, $sum, $min, $max, field refs "$field" — all allowed.
 */
function hasForbiddenAggregationOperator(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  const rec = obj as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (FORBIDDEN_OPERATORS.includes(key)) return true;
    if (hasForbiddenAggregationOperator(rec[key])) return true;
  }
  return false;
}

/** Ensure $unwind path is prefixed with '$' (MongoDB requires it). Fixes LLM output like path: "userDoc". */
function normalizeUnwindPaths(pipeline: unknown[]): void {
  for (const stage of pipeline) {
    if (stage === null || typeof stage !== 'object' || Array.isArray(stage)) continue;
    const s = stage as Record<string, unknown>;
    const inner = s.$unwind;
    if (inner == null) continue;
    if (typeof inner === 'string' && inner.length > 0 && !inner.startsWith('$')) {
      (s as Record<string, string>).$unwind = `$${inner}`;
      continue;
    }
    if (typeof inner === 'object' && !Array.isArray(inner)) {
      const obj = inner as Record<string, unknown>;
      const path = obj.path;
      if (typeof path === 'string' && path.length > 0 && !path.startsWith('$')) {
        obj.path = `$${path}`;
      }
    }
  }
}

function validatePipelineStages(pipeline: unknown[]): void {
  for (let i = 0; i < pipeline.length; i++) {
    const stage = pipeline[i];
    if (stage === null || typeof stage !== 'object' || Array.isArray(stage)) {
      throw new Error(`Invalid aggregation stage at index ${i}: must be an object`);
    }
    const keys = Object.keys(stage as object);
    if (keys.length !== 1) {
      throw new Error(`Invalid aggregation stage at index ${i}: exactly one key allowed (e.g. $match, $group)`);
    }
    const stageName = keys[0]!;
    if (!ALLOWED_AGGREGATION_STAGES_SET.has(stageName)) {
      throw new Error(
        `Forbidden aggregation stage "${stageName}". Allowed: ${ALLOWED_AGGREGATION_STAGES.join(', ')}`
      );
    }
    const inner = (stage as Record<string, unknown>)[stageName];
    if (stageName === '$lookup' && inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
      const fromCol = (inner as Record<string, unknown>).from;
      const fromStr = typeof fromCol === 'string' ? fromCol.trim() : '';
      if (!fromStr || !ALLOWED_COLLECTIONS.includes(fromStr as AllowedCollection)) {
        throw new Error(
          `$lookup "from" must be an allowed collection. Allowed: ${ALLOWED_COLLECTIONS.join(', ')}`
        );
      }
    }
    if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
      if (hasForbiddenAggregationOperator(inner)) {
        throw new Error(`Aggregation stage "${stageName}" uses forbidden operators`);
      }
    }
    // $sort and $limit can have array or simple values; recurse into objects only
    if (inner !== null && typeof inner === 'object' && Array.isArray(inner)) {
      for (const item of inner) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          if (hasForbiddenAggregationOperator(item)) {
            throw new Error(`Aggregation stage "${stageName}" uses forbidden operators`);
          }
        }
      }
    }
  }
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export type MongoQueryInput = {
  collection: string;
  filter?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  limit?: number;
};

export type MongoFindSanitized = {
  collection: AllowedCollection;
  filter: Record<string, unknown>;
  projection?: Record<string, unknown>;
  limit: number;
};

export function validateAndSanitizeQuery(input: MongoQueryInput): MongoFindSanitized {
  const col = input.collection?.trim();
  if (!col || !ALLOWED_COLLECTIONS.includes(col as AllowedCollection)) {
    throw new Error(`Invalid collection. Allowed: ${ALLOWED_COLLECTIONS.join(', ')}`);
  }
  const filter =
    input.filter && typeof input.filter === 'object'
      ? (input.filter as Record<string, unknown>)
      : {};
  if (hasForbiddenOperator(filter)) {
    throw new Error('Query uses forbidden operators (e.g. $where, $function).');
  }
  const projection =
    input.projection && typeof input.projection === 'object'
      ? (input.projection as Record<string, unknown>)
      : undefined;
  let limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.floor(input.limit)
      : DEFAULT_LIMIT;
  limit = Math.min(Math.max(1, limit), MAX_LIMIT);
  return {
    collection: col as AllowedCollection,
    filter,
    projection,
    limit,
  };
}

export type MongoAggregateSanitized = {
  collection: AllowedCollection;
  pipeline: Record<string, unknown>[];
};

export function validateAndSanitizeAggregate(input: {
  collection: string;
  pipeline: unknown[];
}): MongoAggregateSanitized {
  const col = input.collection?.trim();
  if (!col || !ALLOWED_COLLECTIONS.includes(col as AllowedCollection)) {
    throw new Error(`Invalid collection. Allowed: ${ALLOWED_COLLECTIONS.join(', ')}`);
  }
  const pipeline = Array.isArray(input.pipeline) ? [...input.pipeline] : [];
  normalizeUnwindPaths(pipeline);
  validatePipelineStages(pipeline);
  return {
    collection: col as AllowedCollection,
    pipeline: pipeline as Record<string, unknown>[],
  };
}

export async function runMongoFind(query: MongoFindSanitized): Promise<unknown[]> {
  const cursor = mongoose.connection
    .collection(query.collection)
    .find(query.filter as Record<string, unknown>)
    .limit(query.limit);
  if (query.projection && Object.keys(query.projection).length > 0) {
    cursor.project(query.projection as Record<string, number>);
  }
  return cursor.toArray();
}

export async function runMongoAggregate(query: MongoAggregateSanitized): Promise<unknown[]> {
  const agg = mongoose.connection.collection(query.collection).aggregate(query.pipeline);
  return agg.toArray();
}
