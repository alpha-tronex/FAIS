import mongoose from 'mongoose';

export const INTAKE_APPLY_AUDIT_ACTIONS = ['insert', 'update'] as const;
export type IntakeApplyAuditAction = (typeof INTAKE_APPLY_AUDIT_ACTIONS)[number];

export const INTAKE_CONFLICT_POLICIES = ['append', 'merge_if_match'] as const;
export type IntakeConflictPolicyPersisted = (typeof INTAKE_CONFLICT_POLICIES)[number];

const intakeApplyAuditSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
    subjectUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    extractionId: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentExtraction', required: true, index: true },
    extractionVersion: { type: Number, required: true },
    appliedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    affidavitCollection: { type: String, required: true },
    affidavitRowId: { type: String, required: true },
    action: { type: String, required: true, enum: INTAKE_APPLY_AUDIT_ACTIONS },
    conflictPolicy: { type: String, required: true, enum: INTAKE_CONFLICT_POLICIES },
    /** For updates: selected fields before merge (PII-aware: avoid raw PDF blobs). */
    previousValues: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Fields written (or that would be written) from the intake plan. */
    appliedValues: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true, collection: 'intake_apply_audit', strict: true }
);

intakeApplyAuditSchema.index({ caseId: 1, createdAt: -1 });

export type IntakeApplyAuditDoc = mongoose.InferSchemaType<typeof intakeApplyAuditSchema>;
export const IntakeApplyAuditModel = mongoose.model('IntakeApplyAudit', intakeApplyAuditSchema);
