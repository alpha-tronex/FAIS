export type UserDTO = {
  id: string;
  uname: string;
  email: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  dateOfBirth?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  ssnLast4?: string;
  roleTypeId: number;
  mustResetPassword: boolean;
  /** Set when user is archived (soft delete). */
  archivedAt?: string | null;
  archivedBy?: string | null;
};

export type UserSummaryDTO = {
  id: string;
  uname: string;
  firstName?: string;
  lastName?: string;
};

export type UserCreateDTO = {
  uname: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roleTypeId?: number; // defaults to 1
};

export type UserUpdateDTO = {
  email?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  dateOfBirth?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  roleTypeId?: number;
};
