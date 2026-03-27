/**
 * Document routes: case-scoped upload/list/download/retry/delete + admin-only global query.
 * Mount before cases router so /api/cases/:caseId/documents is matched here.
 */

import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { CaseModel, DocumentModel, DocumentDeletionAuditModel, DocumentExtractionModel } from '../models.js';
import { uploadBuffer, getPresignedGetUrl, isB2Configured } from '../lib/b2-storage.js';
import { processDocument } from '../lib/document-processing.js';
import {
  isDocumentIntakeEnabled,
  processDocumentIntake,
  shouldRunIntakeOnUpload
} from '../lib/document-intake/pipeline.js';
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

/** Petitioner, petitioner attorney, legal assistant on the case, or administrator (any case). */
function canUploadCaseDocuments(
  c: {
    petitionerId?: unknown;
    petitionerAttId?: unknown;
    legalAssistantId?: unknown;
  },
  auth: AuthPayload
): boolean {
  if (auth.roleTypeId === 5) return true;
  if (isPetitionerForCase(c, auth)) return true;
  if (toIdStr(c.petitionerAttId) === auth.sub) return true;
  if (toIdStr(c.legalAssistantId) === auth.sub) return true;
  return false;
}

function canRetry(c: { petitionerId?: unknown }, auth: AuthPayload): boolean {
  return auth.roleTypeId === 5 || isPetitionerForCase(c, auth);
}

/** Only admins may delete documents (e.g. when petitioner is unavailable). */
function isAdmin(auth: AuthPayload): boolean {
  return auth.roleTypeId === 5;
}

function serializeExtraction(e: {
  _id: unknown;
  documentId: unknown;
  caseId: unknown;
  subjectUserId: unknown;
  documentType: string;
  status: string;
  extractionVersion: number;
  rawPayload: unknown;
  fieldConfidences: unknown;
  textQuality: unknown;
  errorMessage?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: String(e._id),
    documentId: String(e.documentId),
    caseId: String(e.caseId),
    subjectUserId: String(e.subjectUserId),
    documentType: e.documentType,
    status: e.status,
    extractionVersion: e.extractionVersion,
    rawPayload: e.rawPayload,
    fieldConfidences: e.fieldConfidences,
    textQuality: e.textQuality ?? null,
    errorMessage: e.errorMessage ?? null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

/** Filter for documents that are not soft-deleted. */
const notDeletedFilter = { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] };

export function createDocumentsRouter(
  auth: Pick<AuthMiddlewares, 'requireAuth' | 'requireAdminOrAiStaff' | 'requireAdmin'>
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

    const docs = await DocumentModel.find({
      caseId: new mongoose.Types.ObjectId(caseId),
      ...notDeletedFilter,
    })
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

  /** List document intake extractions for a case (optional ?documentId= for one document's latest first). */
  router.get('/cases/:caseId/document-intake', auth.requireAuth, async (req, res) => {
    const authPayload = (req as express.Request & { auth: AuthPayload }).auth;
    const caseId = typeof req.params.caseId === 'string' ? req.params.caseId : undefined;
    const documentIdQ =
      typeof req.query.documentId === 'string' && mongoose.isValidObjectId(req.query.documentId)
        ? req.query.documentId
        : undefined;
    if (!caseId || !mongoose.isValidObjectId(caseId)) {
      return sendErrorWithMessage(res, 'Invalid case ID', 400);
    }
    if (!isDocumentIntakeEnabled()) {
      return res.status(503).json({ error: 'Document intake is not enabled. Set DOCUMENT_INTAKE_ENABLED=true.' });
    }
    const caseDoc = await CaseModel.findById(caseId).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!canSeeCase(authPayload, caseDoc)) return res.status(403).json({ error: 'Forbidden' });

    if (documentIdQ) {
      const doc = await DocumentModel.findOne({
        _id: new mongoose.Types.ObjectId(documentIdQ),
        caseId: new mongoose.Types.ObjectId(caseId),
        ...notDeletedFilter,
      }).lean();
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      const latest = await DocumentExtractionModel.findOne({ documentId: doc._id })
        .sort({ extractionVersion: -1 })
        .lean();
      return res.json({ extractions: latest ? [serializeExtraction(latest as any)] : [] });
    }

    const extractions = await DocumentExtractionModel.find({ caseId: new mongoose.Types.ObjectId(caseId) })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ extractions: extractions.map((e) => serializeExtraction(e as any)) });
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
    if (!canUploadCaseDocuments(caseDoc, authPayload)) {
      return res.status(403).json({
        error:
          "Only administrators, the petitioner, the petitioner's attorney, or the assigned legal assistant can upload documents for this case."
      });
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

    if (isDocumentIntakeEnabled() && shouldRunIntakeOnUpload()) {
      processDocumentIntake(documentId).catch((err) => {
        console.error('[documents] Document intake failed for', documentId, err);
      });
    }

    res.status(201).json({
      id: doc._id.toString(),
      caseId: doc.caseId.toString(),
      originalName: doc.originalName,
      size: doc.size,
      status: doc.status,
      createdAt: doc.createdAt,
    });
  });

  router.get('/cases/:caseId/documents/:documentId/intake', auth.requireAuth, async (req, res) => {
    const authPayload = (req as express.Request & { auth: AuthPayload }).auth;
    const caseId = typeof req.params.caseId === 'string' ? req.params.caseId : undefined;
    const documentId = typeof req.params.documentId === 'string' ? req.params.documentId : undefined;
    if (!caseId || !documentId || !mongoose.isValidObjectId(caseId) || !mongoose.isValidObjectId(documentId)) {
      return sendErrorWithMessage(res, 'Invalid case or document ID', 400);
    }
    if (!isDocumentIntakeEnabled()) {
      return res.status(503).json({ error: 'Document intake is not enabled. Set DOCUMENT_INTAKE_ENABLED=true.' });
    }
    const caseDoc = await CaseModel.findById(caseId).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!canSeeCase(authPayload, caseDoc)) return res.status(403).json({ error: 'Forbidden' });

    const doc = await DocumentModel.findOne({
      _id: new mongoose.Types.ObjectId(documentId),
      caseId: new mongoose.Types.ObjectId(caseId),
      ...notDeletedFilter,
    }).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const latest = await DocumentExtractionModel.findOne({ documentId: doc._id })
      .sort({ extractionVersion: -1 })
      .lean();
    if (!latest) return res.status(404).json({ error: 'No intake extraction for this document.' });
    res.json(serializeExtraction(latest as any));
  });

  router.post('/cases/:caseId/documents/:documentId/intake/analyze', auth.requireAuth, async (req, res) => {
    const authPayload = (req as express.Request & { auth: AuthPayload }).auth;
    const caseId = typeof req.params.caseId === 'string' ? req.params.caseId : undefined;
    const documentId = typeof req.params.documentId === 'string' ? req.params.documentId : undefined;
    if (!caseId || !documentId || !mongoose.isValidObjectId(caseId) || !mongoose.isValidObjectId(documentId)) {
      return sendErrorWithMessage(res, 'Invalid case or document ID', 400);
    }
    if (!isDocumentIntakeEnabled()) {
      return res.status(503).json({ error: 'Document intake is not enabled. Set DOCUMENT_INTAKE_ENABLED=true.' });
    }
    if (!isB2Configured()) {
      return res.status(503).json({ error: 'Document storage is not configured.' });
    }
    const caseDoc = await CaseModel.findById(caseId).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!canSeeCase(authPayload, caseDoc)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const doc = await DocumentModel.findOne({
      _id: new mongoose.Types.ObjectId(documentId),
      caseId: new mongoose.Types.ObjectId(caseId),
      ...notDeletedFilter,
    }).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const inflight = await DocumentExtractionModel.findOne({
      documentId: doc._id,
      status: 'processing',
    }).lean();
    if (inflight) {
      return res.status(409).json({ error: 'Intake analysis already in progress for this document.' });
    }

    processDocumentIntake(doc._id).catch((err) => {
      console.error('[documents] Intake analyze failed for', doc._id, err);
    });

    res.status(202).json({
      accepted: true,
      documentId: doc._id.toString(),
      message: 'Intake analysis started. Poll GET .../documents/:documentId/intake for results.',
    });
  });

  router.post('/cases/:caseId/documents/:documentId/intake/reject', auth.requireAuth, async (req, res) => {
    const authPayload = (req as express.Request & { auth: AuthPayload }).auth;
    const caseId = typeof req.params.caseId === 'string' ? req.params.caseId : undefined;
    const documentId = typeof req.params.documentId === 'string' ? req.params.documentId : undefined;
    if (!caseId || !documentId || !mongoose.isValidObjectId(caseId) || !mongoose.isValidObjectId(documentId)) {
      return sendErrorWithMessage(res, 'Invalid case or document ID', 400);
    }
    if (!isDocumentIntakeEnabled()) {
      return res.status(503).json({ error: 'Document intake is not enabled. Set DOCUMENT_INTAKE_ENABLED=true.' });
    }
    const caseDoc = await CaseModel.findById(caseId).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!canSeeCase(authPayload, caseDoc)) return res.status(403).json({ error: 'Forbidden' });

    const doc = await DocumentModel.findOne({
      _id: new mongoose.Types.ObjectId(documentId),
      caseId: new mongoose.Types.ObjectId(caseId),
      ...notDeletedFilter,
    }).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const latest = await DocumentExtractionModel.findOne({ documentId: doc._id })
      .sort({ extractionVersion: -1 })
      .lean();
    if (!latest || latest.status !== 'pending_review') {
      return sendErrorWithMessage(res, 'No pending_review extraction to reject.', 400);
    }

    await DocumentExtractionModel.updateOne(
      { _id: latest._id },
      { $set: { status: 'rejected', updatedAt: new Date() } }
    );
    res.json({ ok: true, id: latest._id.toString(), status: 'rejected' });
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
    if (doc.deletedAt && !isAdmin(authPayload)) {
      return res.status(410).json({ error: 'Document has been deleted.' });
    }

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
    if (!canRetry(caseDoc, authPayload)) return res.status(403).json({ error: 'Forbidden' });

    const doc = await DocumentModel.findOne({
      _id: new mongoose.Types.ObjectId(documentId),
      caseId: new mongoose.Types.ObjectId(caseId),
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (doc.deletedAt) {
      return res.status(410).json({ error: 'Document has been deleted and cannot be retried.' });
    }
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

  router.delete('/cases/:caseId/documents/:documentId', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const authPayload = (req as express.Request & { auth: AuthPayload }).auth;
    const caseId = typeof req.params.caseId === 'string' ? req.params.caseId : undefined;
    const documentId = typeof req.params.documentId === 'string' ? req.params.documentId : undefined;
    if (!caseId || !documentId || !mongoose.isValidObjectId(caseId) || !mongoose.isValidObjectId(documentId)) {
      return sendErrorWithMessage(res, 'Invalid case or document ID', 400);
    }
    const caseDoc = await CaseModel.findById(caseId).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });

    const doc = await DocumentModel.findOne({
      _id: new mongoose.Types.ObjectId(documentId),
      caseId: new mongoose.Types.ObjectId(caseId),
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (doc.deletedAt) {
      return res.status(410).json({ error: 'Document is already deleted.' });
    }

    const now = new Date();
    doc.deletedAt = now;
    doc.deletedBy = new mongoose.Types.ObjectId(authPayload.sub);
    await doc.save();

    await DocumentDeletionAuditModel.create({
      userId: doc.deletedBy,
      documentId: doc._id,
      caseId: new mongoose.Types.ObjectId(caseId),
      documentOriginalName: doc.originalName,
    });

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
