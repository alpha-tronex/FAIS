/**
 * Document intake: fetch PDF → extract text → classify → handler → persist document_extractions.
 * Phase 1: pdf-parse only; weak text records ocrNote (rasterize/OCR in a later phase).
 */

import mongoose from 'mongoose';
import { DocumentModel } from '../../models/document.model.js';
import { DocumentExtractionModel } from '../../models/document-extraction.model.js';
import { CaseModel } from '../../models/case.model.js';
import { getObject } from '../b2-storage.js';
import { extractPdfText } from './pdf-text.js';
import { assessTextQuality } from './text-quality.js';
import { classifyIntakeDocument } from './classify.js';
import { runIntakeHandler } from './handlers/index.js';
import { INTAKE_PIPELINE_VERSION } from './types.js';

export function isDocumentIntakeEnabled(): boolean {
  return process.env.DOCUMENT_INTAKE_ENABLED === 'true';
}

export function shouldRunIntakeOnUpload(): boolean {
  return process.env.DOCUMENT_INTAKE_ON_UPLOAD === 'true';
}

export async function processDocumentIntake(documentId: mongoose.Types.ObjectId): Promise<void> {
  const doc = await DocumentModel.findById(documentId).lean();
  if (!doc || doc.deletedAt) return;

  const caseDoc = await CaseModel.findById(doc.caseId).lean();
  /** Affidavit subject; falls back to uploader if case has no petitioner yet. */
  const subjectUserId = (caseDoc?.petitionerId ?? doc.uploadedBy) as mongoose.Types.ObjectId;
  const subjectFallbackNote = caseDoc?.petitionerId
    ? undefined
    : 'Case has no petitioner; subjectUserId is the document uploader.';

  const last = await DocumentExtractionModel.findOne({ documentId }).sort({ extractionVersion: -1 }).lean();
  const nextVersion = (last?.extractionVersion ?? 0) + 1;

  const processing = await DocumentExtractionModel.create({
    documentId,
    caseId: doc.caseId,
    subjectUserId,
    documentType: 'unknown',
    status: 'processing',
    extractionVersion: nextVersion,
    rawPayload: { pipelineVersion: INTAKE_PIPELINE_VERSION },
    fieldConfidences: {}
  });

  try {
    const buffer = await getObject(doc.b2Key);
    const { text } = await extractPdfText(buffer);
    const textQuality = assessTextQuality(text);
    const documentType = classifyIntakeDocument(text, doc.originalName);
    const handlerResult = runIntakeHandler(documentType, text, doc.originalName);

    const rawPayload = {
      ...handlerResult.payload,
      pipelineVersion: INTAKE_PIPELINE_VERSION,
      classifiedType: documentType,
      ...(subjectFallbackNote ? { subjectFallbackNote } : {}),
      ...(textQuality.weak
        ? {
            ocrNote:
              'Extracted text is thin or low-quality (likely scan). Phase 2+ OCR recommended; values may be incomplete.'
          }
        : {})
    };

    processing.documentType = documentType;
    processing.rawPayload = rawPayload;
    processing.fieldConfidences = handlerResult.fieldConfidences;
    processing.textQuality = textQuality;
    processing.status = 'pending_review';
    processing.errorMessage = null;
    await processing.save();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Intake processing failed';
    processing.status = 'failed';
    processing.errorMessage = message;
    processing.documentType = 'unknown';
    await processing.save();
    throw err;
  }
}
