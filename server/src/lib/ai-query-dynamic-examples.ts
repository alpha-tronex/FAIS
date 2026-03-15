/**
 * Dynamic AI Query RAG examples stored in MongoDB.
 * Load and add examples; RAG layer merges these with static examples and invalidates cache on add.
 */

import mongoose from 'mongoose';
import type { AiQueryExample } from './ai-query-examples.js';
import { AiQueryExampleModel } from '../models/ai-query-example.model.js';

/**
 * Load all dynamic examples from MongoDB.
 * Returns examples in the same shape as static AI_QUERY_EXAMPLES for merging.
 */
export async function loadDynamicExamples(): Promise<AiQueryExample[]> {
  const docs = await AiQueryExampleModel.find({})
    .sort({ createdAt: 1 })
    .lean();
  return docs.map((d) => ({
    question: d.question,
    query: d.query as AiQueryExample['query'],
    result_summary: d.result_summary,
  }));
}

/**
 * Insert a single dynamic example. Does not validate the query; validation is done by the API before calling this.
 */
export async function insertDynamicExample(
  example: AiQueryExample,
  createdBy?: mongoose.Types.ObjectId
): Promise<void> {
  await AiQueryExampleModel.create({
    question: example.question,
    query: example.query,
    result_summary: example.result_summary,
    ...(createdBy && { createdBy }),
  });
}
