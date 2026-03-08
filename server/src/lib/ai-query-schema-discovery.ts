/**
 * Schema discovery for AI Query: introspect allowed MongoDB collections and build
 * a short schema description for the LLM prompt. Runs off the hot path (startup
 * or lazy on first request). Falls back to static schema if discovery fails.
 */

import mongoose from 'mongoose';
import { ALLOWED_COLLECTIONS, MONGO_QUERY_SCHEMA_SHORT } from './mongo-query-schema.js';

const SAMPLE_SIZE = 3;
const MAX_FIELDS_PER_COLLECTION = 25;

let cachedSchema: string | null = null;

function describeValue(val: unknown): string {
  if (val === null) return 'null';
  if (val === undefined) return '?';
  if (typeof val === 'string') return 'string';
  if (typeof val === 'number') return Number.isInteger(val) ? 'number' : 'number';
  if (typeof val === 'boolean') return 'boolean';
  if (val instanceof Date) return 'Date';
  if (mongoose.Types.ObjectId.isValid(val as any)) return 'ObjectId';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'object') return 'object';
  return typeof val;
}

function getFieldsFromDoc(doc: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, val] of Object.entries(doc)) {
    if (key.startsWith('$')) continue;
    fields[key] = describeValue(val);
  }
  return fields;
}

function mergeFieldSets(
  acc: Record<string, string>,
  next: Record<string, string>
): Record<string, string> {
  for (const [k, v] of Object.entries(next)) {
    if (!(k in acc) || acc[k] === '?') acc[k] = v;
  }
  return acc;
}

/**
 * Introspect one collection: sample a few docs and build a short field list with types.
 */
async function discoverCollectionSchema(collectionName: string): Promise<string> {
  const col = mongoose.connection.collection(collectionName);
  const samples = await col.find({}).limit(SAMPLE_SIZE).toArray();
  let merged: Record<string, string> = {};
  for (const doc of samples as Record<string, unknown>[]) {
    merged = mergeFieldSets(merged, getFieldsFromDoc(doc));
  }
  const entries = Object.entries(merged)
    .slice(0, MAX_FIELDS_PER_COLLECTION)
    .map(([name, type]) => `  ${name}: ${type}`);
  const fieldList = entries.length ? entries.join('\n') : '  (no sample docs)';
  return `${collectionName}:\n${fieldList}`;
}

/**
 * Refresh the cached schema by introspecting all allowed collections.
 * Call at startup or on a schedule. Safe to call multiple times.
 */
export async function refreshDiscoveredSchema(): Promise<string> {
  const parts: string[] = [
    'Allowed collections: ' + ALLOWED_COLLECTIONS.join(', ') + '.',
    'Discovered fields (from sample docs):',
  ];
  for (const col of ALLOWED_COLLECTIONS) {
    try {
      const desc = await discoverCollectionSchema(col);
      parts.push(desc);
    } catch {
      parts.push(`${col}: (introspection failed)`);
    }
  }
  parts.push(
    'Use type "find" for simple filters; use type "aggregate" for grouping, sorting, or averaging. Use $lookup + $unwind when joining affidavit data to county via case. In $group, use accumulators ($sum, $avg, $first, $last, $max, $min).'
  );
  cachedSchema = parts.join('\n\n');
  return cachedSchema;
}

/**
 * Return the schema text to use in the LLM prompt. Uses cached discovered schema
 * if available, otherwise falls back to MONGO_QUERY_SCHEMA_SHORT.
 */
export function getSchemaForPrompt(): string {
  if (cachedSchema) return cachedSchema;
  return MONGO_QUERY_SCHEMA_SHORT;
}

/**
 * Whether the cache has been populated by discovery (vs static fallback).
 */
export function hasDiscoveredSchema(): boolean {
  return cachedSchema !== null;
}
