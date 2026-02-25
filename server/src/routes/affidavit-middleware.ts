import express from 'express';
import mongoose from 'mongoose';
import { User, CaseModel } from '../models.js';
import type { AuthPayload } from './middleware.js';

/** Role 2 = Respondent, 4 = Respondent Attorney. They may view the petitioner's affidavit for a case they are on. */
function isRespondentOrRespondentAttorney(roleTypeId: number): boolean {
  return roleTypeId === 2 || roleTypeId === 4;
}

export async function resolveAffidavitTarget(req: express.Request): Promise<{
  auth: AuthPayload;
  targetUserObjectId: string;
}> {
  const auth = (req as express.Request & { auth?: AuthPayload }).auth as AuthPayload;
  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const requestedCaseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;

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

  if (isRespondentOrRespondentAttorney(auth.roleTypeId)) {
    if (!requestedCaseId) {
      throw Object.assign(new Error('Respondents must provide caseId to view an affidavit'), { status: 400 });
    }
    if (!mongoose.isValidObjectId(requestedCaseId)) {
      throw Object.assign(new Error('Invalid caseId'), { status: 400 });
    }
    const caseDoc = await CaseModel.findById(requestedCaseId).lean<any>();
    if (!caseDoc) {
      throw Object.assign(new Error('Case not found'), { status: 404 });
    }
    const respondentId = caseDoc.respondentId?._id?.toString?.() ?? caseDoc.respondentId?.toString?.();
    const respondentAttId = caseDoc.respondentAttId?._id?.toString?.() ?? caseDoc.respondentAttId?.toString?.();
    const petitionerId = caseDoc.petitionerId?._id?.toString?.() ?? caseDoc.petitionerId?.toString?.();
    const isOnCase = auth.sub === respondentId || auth.sub === respondentAttId;
    if (!isOnCase || !petitionerId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    return { auth, targetUserObjectId: petitionerId };
  }

  return { auth, targetUserObjectId: auth.sub };
}
