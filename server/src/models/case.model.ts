import mongoose from 'mongoose';

export const caseSchema = new mongoose.Schema(
  {
    caseNumber: { type: String, required: true, index: true },
    division: { type: String, required: true },
    circuitId: { type: Number },
    countyId: { type: Number },
    numChildren: { type: Number },
    childSupportWorksheetFiled: { type: Boolean },
    formTypeId: { type: Number },

    petitionerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    respondentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    petitionerAttId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    respondentAttId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    // Your migrated legacy cases live in a collection named `case`.
    // We keep normalized-only writes but allow legacy fields to coexist.
    collection: 'case',
    strict: true,
    strictQuery: true
  }
);

export type CaseDoc = mongoose.InferSchemaType<typeof caseSchema>;
export const CaseModel = mongoose.model('Case', caseSchema);
