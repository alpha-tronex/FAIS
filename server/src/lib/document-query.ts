/**
 * Document Q&A: embed question → Atlas vector search over document_chunks → LLM with context → answer + sources.
 * Admin only; global scope (all documents).
 */

import mongoose from 'mongoose';
import OpenAI from 'openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { DocumentChunkModel, DocumentModel } from '../models/document.model.js';
import { getOpenAIClient } from './openai.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const VECTOR_INDEX_NAME = 'vector_index';
const TOP_K = 8;

let embeddings: OpenAIEmbeddings | null = null;

function getEmbeddings(): OpenAIEmbeddings {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for document query');
  if (!embeddings) {
    embeddings = new OpenAIEmbeddings({
      model: EMBEDDING_MODEL,
      openAIApiKey: apiKey,
    });
  }
  return embeddings;
}

export type DocumentQueryResult = {
  answer: string;
  sources: { documentName: string; page?: number }[];
};

/**
 * Run vector search on document_chunks (Atlas Vector Search).
 * Requires a vector index named "vector_index" on the embedding field.
 */
async function vectorSearchChunks(
  queryVector: number[],
  limit: number = TOP_K
): Promise<{ text: string; documentName: string; page?: number; documentId: mongoose.Types.ObjectId }[]> {
  const coll = mongoose.connection.collection('document_chunks');
  const cursor = coll.aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: 'embedding',
        queryVector,
        numCandidates: Math.min(limit * 10, 100),
        limit,
      },
    },
    {
      $project: {
        text: 1,
        documentName: 1,
        page: 1,
        documentId: 1,
      },
    },
  ]);
  const docs = await cursor.toArray();
  return (docs as { text?: string; documentName?: string; page?: number; documentId?: unknown }[]).map((d) => ({
    text: d.text ?? '',
    documentName: d.documentName ?? 'document',
    page: d.page ?? undefined,
    documentId: d.documentId as mongoose.Types.ObjectId,
  }));
}

/**
 * If Atlas vector search is not available (e.g. self-hosted MongoDB), fall back to in-memory similarity.
 */
async function vectorSearchChunksFallback(
  queryVector: number[],
  limit: number = TOP_K
): Promise<{ text: string; documentName: string; page?: number; documentId: mongoose.Types.ObjectId }[]> {
  const chunks = await DocumentChunkModel.find({})
    .select({ text: 1, documentName: 1, page: 1, embedding: 1, documentId: 1 })
    .lean();
  if (chunks.length === 0) return [];

  function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }

  const withScore = (
    chunks as { text: string; documentName: string; page?: number; embedding: number[]; documentId: mongoose.Types.ObjectId }[]
  ).map((c) => ({ ...c, score: cosineSimilarity(c.embedding, queryVector) }));
  withScore.sort((a, b) => b.score - a.score);
  return withScore.slice(0, limit).map(({ text, documentName, page, documentId }) => ({
    text,
    documentName,
    page,
    documentId,
  }));
}

export async function queryDocuments(question: string): Promise<DocumentQueryResult> {
  const emb = getEmbeddings();
  const queryVector = await emb.embedQuery(question.trim());
  if (queryVector.length === 0) {
    return { answer: 'No embedding could be generated for the question.', sources: [] };
  }

  let chunks: { text: string; documentName: string; page?: number; documentId: mongoose.Types.ObjectId }[];
  try {
    chunks = await vectorSearchChunks(queryVector, TOP_K);
  } catch {
    chunks = await vectorSearchChunksFallback(queryVector, TOP_K);
  }

  const deletedDocumentIds = new Set<string>();
  if (chunks.length > 0) {
    const documentIds = [...new Set(chunks.map((c) => c.documentId.toString()))];
    const deleted = await DocumentModel.find({
      _id: { $in: documentIds.map((id) => new mongoose.Types.ObjectId(id)) },
      deletedAt: { $exists: true, $ne: null },
    })
      .select({ _id: 1 })
      .lean();
    for (const d of deleted) deletedDocumentIds.add(d._id.toString());
  }
  chunks = chunks.filter((c) => !deletedDocumentIds.has(c.documentId.toString()));

  if (chunks.length === 0) {
    return {
      answer: 'No documents have been processed yet, or no relevant excerpts were found. Upload and process PDFs first.',
      sources: [],
    };
  }

  const excerpts = chunks
    .map((c, i) => {
      const source = c.page != null ? `${c.documentName} (page ${c.page})` : c.documentName;
      return `[${i + 1}] (Source: ${source})\n${c.text}`;
    })
    .join('\n\n');

  const client = getOpenAIClient();
  if (!client) {
    return {
      answer: 'AI is not configured. Set OPENAI_API_KEY to enable document Q&A.',
      sources: [...new Map(chunks.map((c) => [c.documentName + (c.page ?? '')!, c])).values()].map((c) => ({
        documentName: c.documentName,
        page: c.page,
      })),
    };
  }

  const systemContent = `You answer questions based only on the provided document excerpts. Cite sources as "Source: document name (page N)" when page is given, or "Source: document name" otherwise. If the excerpts do not contain enough information, say so. Do not make up information.`;

  const userContent = `Document excerpts:\n\n${excerpts}\n\nQuestion: ${question.trim()}\n\nProvide a concise answer and cite sources.`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
    max_tokens: 1024,
  });

  const answer = completion.choices?.[0]?.message?.content?.trim() ?? 'No response generated.';
  const sources = [...new Map(chunks.map((c) => [c.documentName + (c.page ?? '')!, { documentName: c.documentName, page: c.page }])).values()];

  return { answer, sources };
}
