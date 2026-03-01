import mongoose from 'mongoose';

export const messageSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    readAt: { type: Date, required: false, default: null },
  },
  {
    timestamps: true,
    collection: 'messages',
    strict: true,
    strictQuery: true,
  }
);

messageSchema.index({ recipientId: 1, readAt: 1 });
messageSchema.index({ senderId: 1, recipientId: 1 });
messageSchema.index({ createdAt: -1 });

export type MessageDoc = mongoose.InferSchemaType<typeof messageSchema>;
export const MessageModel = mongoose.model('Message', messageSchema);
