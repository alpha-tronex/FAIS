/**
 * MongoDB model for dynamic AI Query RAG examples.
 * Used alongside the static AI_QUERY_EXAMPLES; merged at retrieval time for embeddings.
 */

import mongoose from 'mongoose';

const aiQueryExampleSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    query: { type: mongoose.Schema.Types.Mixed, required: true },
    result_summary: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  },
  {
    timestamps: true,
    collection: 'ai_query_examples',
    strict: true,
  }
);

export const AiQueryExampleModel = mongoose.model('AiQueryExample', aiQueryExampleSchema);
