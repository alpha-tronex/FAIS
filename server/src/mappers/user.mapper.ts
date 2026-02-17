import type { UserDTO, UserSummaryDTO, UserUpdateDTO } from '../dto/user.dto.js';
import { pickFirstNumber, pickFirstString } from './common.js';

export function toUserDTO(doc: any): UserDTO {
  const id = doc?._id?.toString?.() ?? String(doc?._id ?? '');
  const uname = pickFirstString(doc?.uname, doc?.Uname) ?? '';
  const email = pickFirstString(doc?.email, doc?.Email) ?? '';

  const firstName = pickFirstString(doc?.firstName) ?? undefined;
  const lastName = pickFirstString(doc?.lastName) ?? undefined;

  const addressLine1 = pickFirstString(doc?.addressLine1) ?? undefined;
  const addressLine2 = pickFirstString(doc?.addressLine2) ?? undefined;
  const city = pickFirstString(doc?.city) ?? undefined;
  const state = pickFirstString(doc?.state) ?? undefined;
  const zipCode = pickFirstString(doc?.zipCode) ?? undefined;
  const phone = pickFirstString(doc?.phone) ?? undefined;
  const ssnLast4 = pickFirstString(doc?.ssnLast4) ?? undefined;

  const roleTypeId = pickFirstNumber(doc?.roleTypeId) ?? 1;
  const mustResetPassword = Boolean(doc?.mustResetPassword ?? doc?.MustResetPassword ?? false);

  return {
    id,
    uname,
    email,
    firstName,
    lastName,
		addressLine1,
		addressLine2,
		city,
		state,
		zipCode,
		phone,
		ssnLast4,
    roleTypeId,
    mustResetPassword
  };
}

export function toUserSummaryDTO(doc: any): UserSummaryDTO {
  const id = doc?._id?.toString?.() ?? String(doc?._id ?? '');
  const uname = pickFirstString(doc?.uname, doc?.Uname) ?? '';
  const firstName = pickFirstString(doc?.firstName) ?? undefined;
  const lastName = pickFirstString(doc?.lastName) ?? undefined;

  return { id, uname, firstName, lastName };
}

export function toNormalizedUserUpdate(update: UserUpdateDTO): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (update.email !== undefined) out.email = update.email;
  if (update.firstName !== undefined) out.firstName = update.firstName;
  if (update.lastName !== undefined) out.lastName = update.lastName;
	if (update.addressLine1 !== undefined) out.addressLine1 = update.addressLine1;
	if (update.addressLine2 !== undefined) out.addressLine2 = update.addressLine2;
	if (update.city !== undefined) out.city = update.city;
	if (update.state !== undefined) out.state = update.state;
	if (update.zipCode !== undefined) out.zipCode = update.zipCode;
	if (update.phone !== undefined) out.phone = update.phone;
  if (update.roleTypeId !== undefined) out.roleTypeId = update.roleTypeId;
  return out;
}
