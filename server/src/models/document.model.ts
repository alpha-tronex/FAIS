import mongoose from 'mongoose';

export const DOCUMENT_STATUS = ['uploaded', 'processing', 'ready', 'failed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS)[number];

const documentSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    originalName: { type: String, required: true },
    b2Key: { type: String, required: true },
    mimeType: { type: String, required: true, default: 'application/pdf' },
    size: { type: Number, required: true },
    status: { type: String, required: true, enum: DOCUMENT_STATUS, default: 'uploaded', index: true },
    errorMessage: { type: String, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'documents', strict: true }
);

documentSchema.index({ deletedAt: 1 });

export type DocumentDoc = mongoose.InferSchemaType<typeof documentSchema>;
export const DocumentModel = mongoose.model('Document', documentSchema);

const documentChunkSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
    page: { type: Number, default: null },
    documentName: { type: String, required: true },
  },
  { collection: 'document_chunks', strict: true }
);

export type DocumentChunkDoc = mongoose.InferSchemaType<typeof documentChunkSchema>;
export const DocumentChunkModel = mongoose.model('DocumentChunk', documentChunkSchema);
