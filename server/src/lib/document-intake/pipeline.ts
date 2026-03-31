/**
 * Document intake: fetch PDF → extract text → (optional Textract OCR if weak) → classify → handler → persist.
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
import {
  extractTextWithTextract,
  isTextractIntakeOcrEnabled,
  TEXTRACT_SYNC_MAX_PDF_PAGES
} from './textract-ocr.js';

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
    const { text: pdfParseText, numPages } = await extractPdfText(buffer);
    let workingText = pdfParseText;
    let textQuality = assessTextQuality(workingText);
    const textractMeta: Record<string, unknown> = {};
    const pageCount = numPages ?? 1;

    if (textQuality.weak && isTextractIntakeOcrEnabled()) {
      if (pageCount > TEXTRACT_SYNC_MAX_PDF_PAGES) {
        textractMeta.ocrTextractSkippedReason = 'pdf_exceeds_sync_page_limit';
        textractMeta.ocrTextractMaxSyncPages = TEXTRACT_SYNC_MAX_PDF_PAGES;
        textractMeta.ocrTextractPdfPages = pageCount;
      } else {
        try {
          const ocrText = await extractTextWithTextract(buffer);
          const trimmed = ocrText.trim();
          if (trimmed.length > 0) {
            workingText = ocrText;
            textQuality = assessTextQuality(workingText);
            textractMeta.ocrTextractApplied = true;
          } else {
            textractMeta.ocrTextractEmptyResponse = true;
          }
        } catch (e: unknown) {
          textractMeta.ocrTextractError = e instanceof Error ? e.message : String(e);
        }
      }
    }

    const documentType = classifyIntakeDocument(workingText, doc.originalName);
    const handlerResult = runIntakeHandler(documentType, workingText, doc.originalName);

    const rawPayload = {
      ...handlerResult.payload,
      pipelineVersion: INTAKE_PIPELINE_VERSION,
      classifiedType: documentType,
      ...textractMeta,
      ...(subjectFallbackNote ? { subjectFallbackNote } : {}),
      ...(textQuality.weak
        ? {
            ocrNote:
              'Extracted text is thin or low-quality (likely scan). Review carefully; enable DOCUMENT_INTAKE_TEXTRACT with AWS credentials for Amazon Textract recovery (sync PDFs up to 3 pages).'
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
