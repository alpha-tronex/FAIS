/**
 * Domain helpers for affidavit (user/case display and membership).
 */
export function userFullName(user: { firstName?: string; lastName?: string; uname?: string } | null | undefined): string {
  const first = String(user?.firstName ?? '').trim();
  const last = String(user?.lastName ?? '').trim();
  const full = `${first} ${last}`.trim();
  return full || String(user?.uname ?? '').trim();
}

export function userDisplayName(user: { firstName?: string; lastName?: string; uname?: string } | null | undefined): string {
  return userFullName(user);
}

export function caseIncludesUser(caseDoc: {
  petitionerId?: unknown;
  respondentId?: unknown;
  petitionerAttId?: unknown;
  respondentAttId?: unknown;
}, userObjectId: string): boolean {
  const target = String(userObjectId);
  const ids = [caseDoc?.petitionerId, caseDoc?.respondentId, caseDoc?.petitionerAttId, caseDoc?.respondentAttId]
    .map((v: unknown) => (v as { _id?: { toString?: () => string } })?._id?.toString?.() ?? (v as object)?.toString?.())
    .filter(Boolean);
  return ids.some((id: string) => id === target);
}
