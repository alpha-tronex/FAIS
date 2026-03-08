/**
 * Document processing: fetch from B2 → extract text (pdf-parse) → chunk → embed → store in document_chunks.
 * Run as background job after upload or on retry.
 */

import { createRequire } from 'module';
import mongoose from 'mongoose';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { DocumentModel, DocumentChunkModel } from '../models/document.model.js';
import { getObject } from './b2-storage.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages?: number }>;

const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

let embeddings: OpenAIEmbeddings | null = null;

function getEmbeddings(): OpenAIEmbeddings {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for document processing');
  if (!embeddings) {
    embeddings = new OpenAIEmbeddings({
      model: EMBEDDING_MODEL,
      openAIApiKey: apiKey,
    });
  }
  return embeddings;
}

/** Extract text from PDF buffer. Uses pdf-parse (CJS). */
async function extractTextFromPdf(buffer: Buffer): Promise<{ text: string; numPages?: number }> {
  const result = await pdfParse(buffer);
  return { text: result.text || '', numPages: result.numpages };
}

/** Split text into chunks with optional page tracking (pdf-parse doesn't give per-page text easily; we attach page 1 for now). */
async function chunkText(text: string): Promise<{ text: string; page: number | null }[]> {
  if (!text || !text.trim()) return [];
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  const chunks = await splitter.splitText(text.trim());
  return chunks.map((t) => ({ text: t, page: null }));
}

export async function processDocument(documentId: mongoose.Types.ObjectId): Promise<void> {
  const doc = await DocumentModel.findById(documentId).lean();
  if (!doc) throw new Error('Document not found');
  if (doc.status !== 'uploaded') return;

  await DocumentModel.findByIdAndUpdate(documentId, {
    status: 'processing',
    errorMessage: null,
    updatedAt: new Date(),
  });

  try {
    const buffer = await getObject(doc.b2Key);
    const { text } = await extractTextFromPdf(buffer);
    const chunksWithMeta = await chunkText(text);
    if (chunksWithMeta.length === 0) {
      await DocumentModel.findByIdAndUpdate(documentId, {
        status: 'failed',
        errorMessage: 'No text could be extracted from the PDF.',
        updatedAt: new Date(),
      });
      return;
    }

    const emb = getEmbeddings();
    const texts = chunksWithMeta.map((c) => c.text);
    const vectors = await emb.embedDocuments(texts);

    await DocumentChunkModel.deleteMany({ documentId });

    const documentName = doc.originalName || 'document.pdf';
    const chunkDocs = chunksWithMeta.map((c, i) => ({
      documentId,
      chunkIndex: i,
      text: c.text,
      embedding: vectors[i] ?? [],
      page: c.page,
      documentName,
    }));

    await DocumentChunkModel.insertMany(chunkDocs);

    await DocumentModel.findByIdAndUpdate(documentId, {
      status: 'ready',
      errorMessage: null,
      updatedAt: new Date(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Processing failed';
    await DocumentModel.findByIdAndUpdate(documentId, {
      status: 'failed',
      errorMessage: message,
      updatedAt: new Date(),
    });
    throw err;
  }
}
