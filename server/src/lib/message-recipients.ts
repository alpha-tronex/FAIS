import mongoose from 'mongoose';
import { CaseModel, User } from '../models.js';

const MESSAGING_ROLES = [1, 3, 5, 6] as const;

/**
 * Returns the set of user IDs the given user is allowed to message (as recipient).
 * Respondents (2) and Respondent Attorneys (4) are excluded from messaging entirely.
 */
export async function getAllowedRecipientIds(
  userId: string,
  roleTypeId: number
): Promise<Set<string>> {
  const oid = new mongoose.Types.ObjectId(userId);
  const result = new Set<string>();

  if (roleTypeId === 2 || roleTypeId === 4) {
    return result;
  }

  if (roleTypeId === 1) {
    // Petitioner: petitioner attorney and legal assistant of their cases
    const cases = await CaseModel.find({ petitionerId: oid })
      .select({ petitionerAttId: 1, legalAssistantId: 1 })
      .lean();
    for (const c of cases) {
      const attId = (c as any).petitionerAttId?.toString?.();
      const laId = (c as any).legalAssistantId?.toString?.();
      if (attId && attId !== userId) result.add(attId);
      if (laId && laId !== userId) result.add(laId);
    }
    return result;
  }

  if (roleTypeId === 3) {
    // Petitioner Attorney: petitioners on their cases; all admins; all legal assistants; other petitioner attorneys
    const cases = await CaseModel.find({ petitionerAttId: oid })
      .select({ petitionerId: 1 })
      .lean();
    for (const c of cases) {
      const pid = (c as any).petitionerId?.toString?.();
      if (pid && pid !== userId) result.add(pid);
    }
    const staff = await User.find({
      roleTypeId: { $in: [5, 6, 3] },
      _id: { $ne: oid },
      passwordHash: { $exists: true, $ne: null }
    })
      .select({ _id: 1 })
      .lean();
    for (const u of staff) result.add((u as any)._id.toString());
    return result;
  }

  if (roleTypeId === 6) {
    // Legal Assistant: petitioners on their cases; all admins; all petitioner attorneys; other legal assistants
    const cases = await CaseModel.find({ legalAssistantId: oid })
      .select({ petitionerId: 1 })
      .lean();
    for (const c of cases) {
      const pid = (c as any).petitionerId?.toString?.();
      if (pid && pid !== userId) result.add(pid);
    }
    const staff = await User.find({
      roleTypeId: { $in: [5, 3, 6] },
      _id: { $ne: oid },
      passwordHash: { $exists: true, $ne: null }
    })
      .select({ _id: 1 })
      .lean();
    for (const u of staff) result.add((u as any)._id.toString());
    return result;
  }

  if (roleTypeId === 5) {
    // Admin: everyone with messaging role who has login
    const users = await User.find({
      roleTypeId: { $in: MESSAGING_ROLES },
      _id: { $ne: oid },
      passwordHash: { $exists: true, $ne: null }
    })
      .select({ _id: 1 })
      .lean();
    for (const u of users) result.add((u as any)._id.toString());
    return result;
  }

  return result;
}

export function canAccessMessaging(roleTypeId: number): boolean {
  return MESSAGING_ROLES.includes(roleTypeId as 1 | 3 | 5 | 6);
}
