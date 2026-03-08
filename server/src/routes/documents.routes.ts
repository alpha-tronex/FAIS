/**
 * Document routes: case-scoped upload/list/download/retry/delete + admin-only global query.
 * Mount before cases router so /api/cases/:caseId/documents is matched here.
 */

import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { CaseModel, DocumentModel, DocumentChunkModel } from '../models.js';
import { uploadBuffer, getObject, deleteObject, getPresignedGetUrl, isB2Configured } from '../lib/b2-storage.js';
import { processDocument } from '../lib/document-processing.js';
import { queryDocuments } from '../lib/document-query.js';
import { sendError, sendErrorWithMessage } from './error.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const PDF_MAGIC = Buffer.from('%PDF-', 'utf8');

function toIdStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && '_id' in v) return String((v as { _id: unknown })._id);
  return String(v);
}

function canSeeCase(
  auth: AuthPayload,
  c: { petitionerId?: unknown; respondentId?: unknown; petitionerAttId?: unknown; respondentAttId?: unknown; legalAssistantId?: unknown }
): boolean {
  if (auth.roleTypeId === 5) return true;
  const userId = auth.sub;
  return (
    toIdStr(c.petitionerId) === userId ||
    toIdStr(c.respondentId) === userId ||
    toIdStr(c.petitionerAttId) === userId ||
    toIdStr(c.respondentAttId) === userId ||
    toIdStr(c.legalAssistantId) === userId
  );
}

function isPetitionerForCase(c: { petitionerId?: unknown }, auth: AuthPayload): boolean {
  return toIdStr(c.petitionerId) === auth.sub;
}

function canDeleteOrRetry(c: { petitionerId?: unknown }, auth: AuthPayload): boolean {
  return auth.roleTypeId === 5 || isPetitionerForCase(c, auth);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

export function createDocumentsRouter(
  auth: Pick<AuthMiddlewares, 'requireAuth' | 'requireAdminOrAiStaff'>
): express.Router {
  const router = express.Router();

  router.get('/cases/:caseId/documents', auth.requireAuth, async (req, res) => {
    const authPayload = (req as express.Request & { auth: AuthPayload }).auth;
    const caseId = typeof req.params.caseId === 'string' ? req.params.caseId : undefined;
    if (!caseId || !mongoose.isValidObjectId(caseId)) {
      return sendErrorWithMessage(res, 'Invalid case ID', 400);
    }
    const caseDoc = await CaseModel.findById(caseId).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!canSeeCase(authPayload, caseDoc)) return res.status(403).json({ error: 'Forbidden' });

    const docs = await DocumentModel.find({ caseId: new mongoose.Types.ObjectId(caseId) })
      .sort({ createdAt: -1 })
      .lean();
    res.json(
      docs.map((d) => ({
        id: d._id.toString(),
        caseId: d.caseId.toString(),
        originalName: d.originalName,
        size: d.size,
        status: d.status,
        errorMessage: d.errorMessage ?? null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }))
    );
  });

  router.post('/cases/:caseId/documents', auth.requireAuth, upload.single('file'), async (req, res) => {
    const authPayload = (req as express.Request & { auth: AuthPayload }).auth;
    const caseId = typeof req.params.caseId === 'string' ? req.params.caseId : undefined;
    if (!caseId || !mongoose.isValidObjectId(caseId)) {
      return sendErrorWithMessage(res, 'Invalid case ID', 400);
    }
    if (!isB2Configured()) {
      return res.status(503).json({ error: 'Document storage is not configured.' });
    }
    const caseDoc = await CaseModel.findById(caseId).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!isPetitionerForCase(caseDoc, authPayload)) {
      return res.status(403).json({ error: 'Only the petitioner for this case can upload documents.' });
    }

    const file = (req as express.Request & { file?: Express.Multer.File }).file;
    if (!file || !file.buffer) {
      return sendErrorWithMessage(res, 'No file uploaded. Use field name "file".', 400);
    }
    if (file.size > MAX_FILE_SIZE) {
      return sendErrorWithMessage(res, `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.`, 400);
    }
    if (!file.buffer.subarray(0, 5).equals(PDF_MAGIC)) {
      return sendErrorWithMessage(res, 'Only PDF files are allowed.', 400);
    }

    const documentId = new mongoose.Types.ObjectId();
    const b2Key = `documents/${documentId.toString()}.pdf`;

    try {
      await uploadBuffer(b2Key, file.buffer, 'application/pdf');
    } catch (e) {
      return sendError(res, e, 500);
    }

    const doc = await DocumentModel.create({
      _id: documentId,
      caseId: new mongoose.Types.ObjectId(caseId),
      uploadedBy: new mongoose.Types.ObjectId(authPayload.sub),
      originalName: file.originalname || 'document.pdf',
      b2Key,
      mimeType: 'application/pdf',
      size: file.size,
      status: 'uploaded',
    });

    processDocument(documentId).catch((err) => {
      console.error('[documents] Background processing failed for', documentId, err);
    });

    res.status(201).json({
      id: doc._id.toString(),
      caseId: doc.caseId.toString(),
      originalName: doc.originalName,
      size: doc.size,
      status: doc.status,
      createdAt: doc.createdAt,
    });
  });

  router.get('/cases/:caseId/documents/:documentId/download', auth.requireAuth, async (req, res) => {
    const authPayload = (req as express.Request & { auth: AuthPayload }).auth;
    const caseId = typeof req.params.caseId === 'string' ? req.params.caseId : undefined;
    const documentId = typeof req.params.documentId === 'string' ? req.params.documentId : undefined;
    if (!caseId || !documentId || !mongoose.isValidObjectId(caseId) || !mongoose.isValidObjectId(documentId)) {
      return sendErrorWithMessage(res, 'Invalid case or document ID', 400);
    }
    const caseDoc = await CaseModel.findById(caseId).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!canSeeCase(authPayload, caseDoc)) return res.status(403).json({ error: 'Forbidden' });

    const doc = await DocumentModel.findOne({
      _id: new mongoose.Types.ObjectId(documentId),
      caseId: new mongoose.Types.ObjectId(caseId),
    }).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    try {
      const url = await getPresignedGetUrl(doc.b2Key);
      res.json({ url });
    } catch (e) {
      sendError(res, e, 500);
    }
  });

  router.post('/cases/:caseId/documents/:documentId/retry', auth.requireAuth, async (req, res) => {
    const authPayload = (req as express.Request & { auth: AuthPayload }).auth;
    const caseId = typeof req.params.caseId === 'string' ? req.params.caseId : undefined;
    const documentId = typeof req.params.documentId === 'string' ? req.params.documentId : undefined;
    if (!caseId || !documentId || !mongoose.isValidObjectId(caseId) || !mongoose.isValidObjectId(documentId)) {
      return sendErrorWithMessage(res, 'Invalid case or document ID', 400);
    }
    const caseDoc = await CaseModel.findById(caseId).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!canDeleteOrRetry(caseDoc, authPayload)) return res.status(403).json({ error: 'Forbidden' });

    const doc = await DocumentModel.findOne({
      _id: new mongoose.Types.ObjectId(documentId),
      caseId: new mongoose.Types.ObjectId(caseId),
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (doc.status !== 'failed') {
      return sendErrorWithMessage(res, 'Only failed documents can be retried.', 400);
    }

    doc.status = 'uploaded';
    doc.errorMessage = undefined;
    await doc.save();

    processDocument(doc._id).catch((err) => {
      console.error('[documents] Retry processing failed for', doc._id, err);
    });

    res.json({
      id: doc._id.toString(),
      status: doc.status,
    });
  });

  router.delete('/cases/:caseId/documents/:documentId', auth.requireAuth, async (req, res) => {
    const authPayload = (req as express.Request & { auth: AuthPayload }).auth;
    const caseId = typeof req.params.caseId === 'string' ? req.params.caseId : undefined;
    const documentId = typeof req.params.documentId === 'string' ? req.params.documentId : undefined;
    if (!caseId || !documentId || !mongoose.isValidObjectId(caseId) || !mongoose.isValidObjectId(documentId)) {
      return sendErrorWithMessage(res, 'Invalid case or document ID', 400);
    }
    const caseDoc = await CaseModel.findById(caseId).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!canDeleteOrRetry(caseDoc, authPayload)) return res.status(403).json({ error: 'Forbidden' });

    const doc = await DocumentModel.findOne({
      _id: new mongoose.Types.ObjectId(documentId),
      caseId: new mongoose.Types.ObjectId(caseId),
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    try {
      await deleteObject(doc.b2Key);
    } catch (e) {
      console.error('[documents] B2 delete failed', doc.b2Key, e);
    }
    await DocumentChunkModel.deleteMany({ documentId: doc._id });
    await DocumentModel.findByIdAndDelete(doc._id);

    res.status(204).send();
  });

  router.post('/documents/query', auth.requireAuth, auth.requireAdminOrAiStaff, async (req, res) => {
    const body = req.body as { question?: string };
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) {
      return sendErrorWithMessage(res, 'question is required', 400);
    }
    try {
      const result = await queryDocuments(question);
      res.json(result);
    } catch (e) {
      if ((e as Error).message?.includes('OPENAI_API_KEY')) {
        return res.status(503).json({ error: 'AI is not configured. Set OPENAI_API_KEY.' });
      }
      sendError(res, e, 500);
    }
  });

  return router;
}
