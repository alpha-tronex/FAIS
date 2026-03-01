import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { MessageModel, User } from '../models.js';
import { toUserSummaryDTO } from '../mappers/user.mapper.js';
import { sendError, sendErrorWithMessage } from './error.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';
import { getAllowedRecipientIds, canAccessMessaging } from '../lib/message-recipients.js';

const sendMessageSchema = z.object({
  recipientId: z.string().min(1),
  body: z.string().min(1).max(10000),
});

const markReadSchema = z.object({
  messageIds: z.array(z.string()).optional(),
  conversationWithUserId: z.string().optional(),
});

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export function createMessagesRouter(
  auth: Pick<AuthMiddlewares, 'requireAuth'>
): express.Router {
  const router = express.Router();

  function requireMessagingRole(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): void {
    const authPayload = (req as any).auth as AuthPayload | undefined;
    if (!authPayload) return next();
    if (!canAccessMessaging(authPayload.roleTypeId)) {
      sendErrorWithMessage(res, 'Forbidden', 403);
      return;
    }
    next();
  }

  router.get(
    '/messages/unread-count',
    auth.requireAuth,
    requireMessagingRole,
    async (req, res) => {
      const authPayload = (req as any).auth as AuthPayload;
      const userId = authPayload.sub;
      try {
        const count = await MessageModel.countDocuments({
          recipientId: new mongoose.Types.ObjectId(userId),
          readAt: null,
        });
        res.json({ count });
      } catch (e) {
        sendError(res, e, 500);
      }
    }
  );

  router.get(
    '/messages/recipients',
    auth.requireAuth,
    requireMessagingRole,
    async (req, res) => {
      const authPayload = (req as any).auth as AuthPayload;
      const userId = authPayload.sub;
      try {
        const allowedIds = await getAllowedRecipientIds(
          userId,
          authPayload.roleTypeId
        );
        if (allowedIds.size === 0) {
          res.json([]);
          return;
        }
        const users = await User.find({
          _id: { $in: Array.from(allowedIds).map((id) => new mongoose.Types.ObjectId(id)) },
        })
          .select({ uname: 1, firstName: 1, lastName: 1, roleTypeId: 1 })
          .lean();
        res.json(
          users.map((u: any) => ({
            ...toUserSummaryDTO(u),
            roleTypeId: u.roleTypeId,
          }))
        );
      } catch (e) {
        sendError(res, e, 500);
      }
    }
  );

  /** Conversations list: other user + last message + unread count for current user. */
  router.get(
    '/messages/conversations',
    auth.requireAuth,
    requireMessagingRole,
    async (req, res) => {
      const authPayload = (req as any).auth as AuthPayload;
      const userId = authPayload.sub;
      const myOid = new mongoose.Types.ObjectId(userId);
      try {
        const allowedIds = await getAllowedRecipientIds(
          userId,
          authPayload.roleTypeId
        );
        const allowedOids = Array.from(allowedIds).map((id) => new mongoose.Types.ObjectId(id));
        const agg = await MessageModel.aggregate([
          {
            $match: {
              $or: [
                { senderId: myOid, recipientId: { $in: allowedOids } },
                { recipientId: myOid, senderId: { $in: allowedOids } },
              ],
            },
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: {
                $cond: [
                  { $eq: ['$senderId', myOid] },
                  '$recipientId',
                  '$senderId',
                ],
              },
              lastMessage: { $first: '$$ROOT' },
              unreadCount: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$recipientId', myOid] },
                        { $eq: ['$readAt', null] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { 'lastMessage.createdAt': -1 } },
          { $limit: 200 },
        ]);
        const otherIds = new Set(
          agg.map((r: any) => r._id?.toString?.()).filter(Boolean)
        );
        if (otherIds.size === 0) {
          res.json([]);
          return;
        }
        const users = await User.find({
          _id: { $in: Array.from(otherIds).map((id) => new mongoose.Types.ObjectId(id)) },
        })
          .select({ uname: 1, firstName: 1, lastName: 1, roleTypeId: 1 })
          .lean();
        const byId = new Map(users.map((u: any) => [u._id.toString(), u]));
        const list = agg.map((r: any) => {
          const otherId = r._id?.toString?.();
          const u = otherId ? byId.get(otherId) : null;
          const last = r.lastMessage;
          return {
            otherUser: otherId
              ? { ...toUserSummaryDTO(u || { _id: otherId }), roleTypeId: (u as any)?.roleTypeId }
              : null,
            lastMessage: last
              ? {
                  id: last._id?.toString?.(),
                  senderId: last.senderId?.toString?.(),
                  recipientId: last.recipientId?.toString?.(),
                  body: last.body,
                  readAt: last.readAt ? (last.readAt as Date).toISOString() : null,
                  createdAt: last.createdAt ? (last.createdAt as Date).toISOString() : null,
                }
              : null,
            unreadCount: r.unreadCount ?? 0,
          };
        });
        res.json(list);
      } catch (e) {
        sendError(res, e, 500);
      }
    }
  );

  /** Conversation with a user; paginated (limit, before message id or date). */
  router.get('/messages', auth.requireAuth, requireMessagingRole, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const userId = authPayload.sub;
    const withUserId = String((req.query?.withUserId ?? '') as string).trim();
    const limitRaw = parseInt(String(req.query?.limit ?? DEFAULT_PAGE_SIZE), 10);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_PAGE_SIZE));
    const before = String((req.query?.before ?? '') as string).trim();

    if (!withUserId || !mongoose.isValidObjectId(withUserId)) {
      return res.status(400).json({ error: 'withUserId is required and must be a valid id' });
    }

    try {
      const allowedIds = await getAllowedRecipientIds(
        userId,
        authPayload.roleTypeId
      );
      if (!allowedIds.has(withUserId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const myOid = new mongoose.Types.ObjectId(userId);
      const otherOid = new mongoose.Types.ObjectId(withUserId);

      const filter: Record<string, unknown> = {
        $or: [
          { senderId: myOid, recipientId: otherOid },
          { senderId: otherOid, recipientId: myOid },
        ],
      };

      if (before) {
        if (mongoose.isValidObjectId(before)) {
          const beforeDoc = await MessageModel.findOne({
            _id: new mongoose.Types.ObjectId(before),
            $or: [
              { senderId: myOid, recipientId: otherOid },
              { senderId: otherOid, recipientId: myOid },
            ],
          }).select({ createdAt: 1 }).lean();
          if (beforeDoc && (beforeDoc as any).createdAt) {
            (filter as any).createdAt = { $lt: (beforeDoc as any).createdAt };
          }
        } else {
          const beforeDate = new Date(before);
          if (!Number.isNaN(beforeDate.getTime())) {
            (filter as any).createdAt = { $lt: beforeDate };
          }
        }
      }

      const messages = await MessageModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      const list = messages.map((m: any) => ({
        id: m._id.toString(),
        senderId: m.senderId?.toString?.(),
        recipientId: m.recipientId?.toString?.(),
        body: m.body,
        readAt: m.readAt ? (m.readAt as Date).toISOString() : null,
        createdAt: m.createdAt ? (m.createdAt as Date).toISOString() : null,
      }));

      res.json(list);
    } catch (e) {
      sendError(res, e, 500);
    }
  });

  router.post('/messages', auth.requireAuth, requireMessagingRole, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }

    const { recipientId, body } = parsed.data;
    if (!mongoose.isValidObjectId(recipientId)) {
      return res.status(400).json({ error: 'Invalid recipientId' });
    }

    try {
      const allowedIds = await getAllowedRecipientIds(
        authPayload.sub,
        authPayload.roleTypeId
      );
      if (!allowedIds.has(recipientId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const doc = await MessageModel.create({
        senderId: new mongoose.Types.ObjectId(authPayload.sub),
        recipientId: new mongoose.Types.ObjectId(recipientId),
        body: body.trim(),
        readAt: null,
      });

      res.status(201).json({
        id: doc._id.toString(),
        senderId: doc.senderId.toString(),
        recipientId: doc.recipientId.toString(),
        body: doc.body,
        readAt: null,
        createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
      });
    } catch (e) {
      sendError(res, e, 500);
    }
  });

  router.patch(
    '/messages/:id/read',
    auth.requireAuth,
    requireMessagingRole,
    async (req, res) => {
      const authPayload = (req as any).auth as AuthPayload;
      const id = typeof req.params.id === 'string' ? req.params.id : undefined;
      if (!id || !mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid message id' });
      }

      try {
        const updated = await MessageModel.findOneAndUpdate(
          {
            _id: new mongoose.Types.ObjectId(id),
            recipientId: new mongoose.Types.ObjectId(authPayload.sub),
            readAt: null,
          },
          { $set: { readAt: new Date() } },
          { new: true }
        ).lean();

        if (!updated) {
          return res.status(404).json({ error: 'Message not found or already read' });
        }
        res.json({
          id: (updated as any)._id.toString(),
          readAt: (updated as any).readAt?.toISOString?.() ?? null,
        });
      } catch (e) {
        sendError(res, e, 500);
      }
    }
  );

  router.post(
    '/messages/mark-read',
    auth.requireAuth,
    requireMessagingRole,
    async (req, res) => {
      const authPayload = (req as any).auth as AuthPayload;
      const parsed = markReadSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const myOid = new mongoose.Types.ObjectId(authPayload.sub);

      try {
        const filter: Record<string, unknown> = {
          recipientId: myOid,
          readAt: null,
        };

        if (parsed.data.messageIds?.length) {
          const validIds = parsed.data.messageIds.filter((id) =>
            mongoose.isValidObjectId(id)
          );
          if (validIds.length) {
            (filter as any)._id = { $in: validIds.map((id) => new mongoose.Types.ObjectId(id)) };
          }
        } else if (parsed.data.conversationWithUserId && mongoose.isValidObjectId(parsed.data.conversationWithUserId)) {
          const otherOid = new mongoose.Types.ObjectId(parsed.data.conversationWithUserId);
          (filter as any).senderId = otherOid;
        }
        // else: empty body = mark all my messages as read (filter stays recipientId + readAt null)

        const result = await MessageModel.updateMany(filter, {
          $set: { readAt: new Date() },
        });
        res.json({ updated: result.modifiedCount });
      } catch (e) {
        sendError(res, e, 500);
      }
    }
  );

  return router;
}
