export type UserDTO = {
  id: string;
  uname: string;
  email: string;
  firstName?: string;
  lastName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  ssnLast4?: string;
  roleTypeId: number;
  mustResetPassword: boolean;
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
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  roleTypeId?: number;
};
