import mongoose from 'mongoose';

export const INTAKE_DOCUMENT_TYPES = [
  'w2',
  'mortgage_statement',
  'utility_electric',
  'credit_card_mastercard',
  'unknown'
] as const;
export type IntakeDocumentType = (typeof INTAKE_DOCUMENT_TYPES)[number];

export const DOCUMENT_EXTRACTION_STATUSES = [
  'processing',
  'pending_review',
  'failed',
  'rejected',
  'applied'
] as const;
export type DocumentExtractionStatus = (typeof DOCUMENT_EXTRACTION_STATUSES)[number];

const documentExtractionSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
    /** Affidavit subject (typically case petitioner). */
    subjectUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentType: {
      type: String,
      required: true,
      enum: INTAKE_DOCUMENT_TYPES,
      default: 'unknown',
      index: true
    },
    status: {
      type: String,
      required: true,
      enum: DOCUMENT_EXTRACTION_STATUSES,
      default: 'processing',
      index: true
    },
    extractionVersion: { type: Number, required: true, default: 1 },
    /** Structured proposal for review / apply (Phase 2). */
    rawPayload: { type: mongoose.Schema.Types.Mixed, required: true, default: () => ({}) },
    fieldConfidences: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    /** Diagnostics only; avoid storing long raw PDF text. */
    textQuality: {
      type: {
        charCount: { type: Number, required: true },
        weak: { type: Boolean, required: true }
      },
      default: null
    },
    errorMessage: { type: String, default: null }
  },
  { timestamps: true, collection: 'document_extractions', strict: true }
);

documentExtractionSchema.index({ caseId: 1, createdAt: -1 });
documentExtractionSchema.index({ documentId: 1, extractionVersion: -1 });

export type DocumentExtractionDoc = mongoose.InferSchemaType<typeof documentExtractionSchema>;
export const DocumentExtractionModel = mongoose.model('DocumentExtraction', documentExtractionSchema);
