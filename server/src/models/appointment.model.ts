import mongoose from 'mongoose';

const statusEnum = ['pending', 'accepted', 'rejected', 'cancelled', 'reschedule_requested'] as const;
export type AppointmentStatus = (typeof statusEnum)[number];

export const appointmentSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true },
    petitionerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    petitionerAttId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    legalAssistantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    scheduledAt: { type: Date, required: true },
    /** Length in minutes (15, 30, 45, or 60). Default 15. */
    durationMinutes: { type: Number, default: 15, min: 15, max: 60 },
    notes: { type: String },
    status: { type: String, enum: statusEnum, default: 'pending', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'appointments',
    strict: true,
    strictQuery: true,
  }
);

export type AppointmentDoc = mongoose.InferSchemaType<typeof appointmentSchema>;
export const AppointmentModel = mongoose.model('Appointment', appointmentSchema);
