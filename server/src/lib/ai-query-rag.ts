/**
 * RAG for AI Query: LangChain OpenAIEmbeddings + in-memory similarity search over (question, query, result_summary) examples.
 * At request time we embed the user question and retrieve top-k similar examples to augment the prompt.
 */

import { OpenAIEmbeddings } from '@langchain/openai';
import type { AiQueryExample, ExampleQuery } from './ai-query-examples.js';
import { AI_QUERY_EXAMPLES } from './ai-query-examples.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const TOP_K = 5;

let embeddings: OpenAIEmbeddings | null = null;
type ExampleWithEmbedding = AiQueryExample & { embedding: number[] };
let examplesWithEmbeddings: ExampleWithEmbedding[] | null = null;

function getEmbeddings(): OpenAIEmbeddings {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for AI query RAG');
  }
  if (!embeddings) {
    embeddings = new OpenAIEmbeddings({
      model: EMBEDDING_MODEL,
      openAIApiKey: apiKey,
    });
  }
  return embeddings;
}

/** Cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Load example embeddings (once). Uses LangChain OpenAIEmbeddings.
 */
async function getExamplesWithEmbeddings(): Promise<ExampleWithEmbedding[]> {
  if (examplesWithEmbeddings) return examplesWithEmbeddings;
  const emb = getEmbeddings();
  const questions = AI_QUERY_EXAMPLES.map((ex) => ex.question);
  const vectors = await emb.embedDocuments(questions);
  examplesWithEmbeddings = AI_QUERY_EXAMPLES.map((ex, i) => ({
    ...ex,
    embedding: vectors[i] ?? [],
  }));
  return examplesWithEmbeddings;
}

export type RetrievedExample = {
  question: string;
  query: ExampleQuery;
  result_summary: string;
};

/**
 * Retrieve the top-k most similar examples for the given user question.
 * Uses LangChain OpenAIEmbeddings for embedding; similarity is cosine in-memory.
 */
export async function retrieveSimilarExamples(
  question: string,
  k: number = TOP_K
): Promise<RetrievedExample[]> {
  const emb = getEmbeddings();
  const queryVector = await emb.embedQuery(question);
  const examples = await getExamplesWithEmbeddings();
  const withScore = examples.map((ex) => ({
    ...ex,
    score: cosineSimilarity(ex.embedding, queryVector),
  }));
  withScore.sort((a, b) => b.score - a.score);
  return withScore.slice(0, k).map(({ question: q, query, result_summary }) => ({
    question: q,
    query,
    result_summary,
  }));
}
