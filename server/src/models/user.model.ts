import mongoose from 'mongoose';

export const userSchema = new mongoose.Schema(
  {
    uname: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    // Normalized-friendly fields (preferred by the API/UI)
    firstName: { type: String },
    lastName: { type: String },
    gender: { type: String },
    dateOfBirth: { type: Date },
    addressLine1: { type: String },
    addressLine2: { type: String },
    city: { type: String },
    state: { type: String },
    zipCode: { type: String },
    phone: { type: String },
    ssnLast4: { type: String },
    ssnCiphertextB64: { type: String },
    ssnIvB64: { type: String },
    ssnAuthTagB64: { type: String },
    roleTypeId: { type: Number, required: true },
    /** Omitted for minimal users (e.g. respondent/respondent attorney) who have no login. */
    passwordHash: { type: String, required: false },
    mustResetPassword: { type: Boolean, required: false, default: true },
    /** Forgot-password: time-limited token sent by email; cleared after use or expiry. */
    passwordResetToken: { type: String, required: false, index: true },
    passwordResetTokenExpiresAt: { type: Date, required: false },
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
		updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    collection: 'users',
    strict: true,
    strictQuery: true
  }
);

export type UserDoc = mongoose.InferSchemaType<typeof userSchema>;
export const User = mongoose.model('User', userSchema);
