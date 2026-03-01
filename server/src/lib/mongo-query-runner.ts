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

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export type MongoQueryInput = {
  collection: string;
  filter?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  limit?: number;
};

export function validateAndSanitizeQuery(input: MongoQueryInput): {
  collection: AllowedCollection;
  filter: Record<string, unknown>;
  projection?: Record<string, unknown>;
  limit: number;
} {
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

export async function runMongoFind(
  query: ReturnType<typeof validateAndSanitizeQuery>
): Promise<unknown[]> {
  const cursor = mongoose.connection
    .collection(query.collection)
    .find(query.filter as Record<string, unknown>)
    .limit(query.limit);
  if (query.projection && Object.keys(query.projection).length > 0) {
    cursor.project(query.projection as Record<string, number>);
  }
  return cursor.toArray();
}
