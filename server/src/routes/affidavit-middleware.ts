import express from 'express';
import mongoose from 'mongoose';
import { User } from '../models.js';
import type { AuthPayload } from './middleware.js';

export async function resolveAffidavitTarget(req: express.Request): Promise<{
  auth: AuthPayload;
  targetUserObjectId: string;
}> {
  const auth = (req as express.Request & { auth?: AuthPayload }).auth as AuthPayload;
  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;

  if (requestedUserId) {
    if (auth.roleTypeId !== 5) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    if (!mongoose.isValidObjectId(requestedUserId)) {
      throw Object.assign(new Error('Invalid userId'), { status: 400 });
    }
    const target = await User.findById(requestedUserId).lean();
    if (!target) {
      throw Object.assign(new Error('Not found'), { status: 404 });
    }
    return { auth, targetUserObjectId: requestedUserId };
  }

  return { auth, targetUserObjectId: auth.sub };
}
