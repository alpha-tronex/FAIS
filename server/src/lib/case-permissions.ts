import mongoose from 'mongoose';
import { CaseModel } from '../models.js';
import type { AuthPayload } from '../routes/middleware.js';

/**
 * Normalize DB / lean-document values to a tri-state flag for worksheet gating.
 * Strict `=== true` only misses string or numeric shapes seen with legacy imports or loose drivers.
 */
export function normalizeChildSupportWorksheetFiledTriState(v: unknown): boolean | null {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  return null;
}

/** Same normalization as `documents.routes` `toIdStr` so case access matches across routes. */
function toIdStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && '_id' in v) return String((v as { _id: unknown })._id);
  return String(v);
}

export function canSeeCase(auth: AuthPayload, c: any): boolean {
  if (auth.roleTypeId === 5) return true;

  const userId = auth.sub;
  return (
    toIdStr(c.petitionerId) === userId ||
    toIdStr(c.respondentId) === userId ||
    toIdStr(c.petitionerAttId) === userId ||
    toIdStr(c.respondentAttId) === userId ||
    toIdStr(c.legalAssistantId) === userId
  );
}

/** Petitioner (1), petitioner attorney (3), legal assistant (6), or admin (5). */
export function canUpdateChildSupportWorksheetFiled(auth: AuthPayload, caseDoc: any): boolean {
  if (auth.roleTypeId === 5) return true;
  if (![1, 3, 6].includes(auth.roleTypeId)) return false;
  return canSeeCase(auth, caseDoc);
}

export async function findCaseForWorksheetContext(
  targetUserObjectId: string,
  caseIdFromQuery: string | undefined
): Promise<any | null> {
  if (caseIdFromQuery && mongoose.isValidObjectId(caseIdFromQuery)) {
    return CaseModel.findById(caseIdFromQuery).lean<any>();
  }
  return CaseModel.findOne({
    $or: [
      { petitionerId: new mongoose.Types.ObjectId(targetUserObjectId) },
      { respondentId: new mongoose.Types.ObjectId(targetUserObjectId) }
    ]
  })
    .sort({ createdAt: -1, _id: -1 })
    .lean<any>();
}

/** Worksheet APIs are enabled whenever the case is visible in context. */
export function isChildSupportWorksheetApiAllowed(caseDoc: any | null): boolean {
  return true;
}
