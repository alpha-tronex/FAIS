import mongoose from 'mongoose';

const documentDeletionAuditSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
    documentOriginalName: { type: String, required: true },
  },
  { timestamps: true, collection: 'document_deletion_audit', strict: true }
);

export type DocumentDeletionAuditDoc = mongoose.InferSchemaType<typeof documentDeletionAuditSchema>;
export const DocumentDeletionAuditModel = mongoose.model(
  'DocumentDeletionAudit',
  documentDeletionAuditSchema
);
