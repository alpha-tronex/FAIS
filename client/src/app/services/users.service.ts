import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type UserListItem = {
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

export type CreateUserRequest = {
  /** Required for full create (user can log in). Omit for minimal create (role 2 or 4 only). */
  uname?: string;
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  /** Required. For minimal create use 2 or 4 (respondent / respondent attorney). */
  roleTypeId?: number;
  /** When true, server sends invitation email. Only used for full create. */
  sendInviteEmail?: boolean;
};

export type CreateUserResponse = {
  id: string;
  uname: string;
};

export type UpdateUserRequest = {
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

export type UserSsnResponse = {
  ssn: string;
  ssnLast4?: string;
};

export type UpdateUserSsnRequest = {
  ssn: string;
  confirmSsn: string;
};

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  async list(): Promise<UserListItem[]> {
    return await firstValueFrom(this.http.get<UserListItem[]>(`${this.apiBase}/users`));
  }

  async get(id: string): Promise<UserListItem> {
    return await firstValueFrom(this.http.get<UserListItem>(`${this.apiBase}/users/${id}`));
  }

  async create(req: CreateUserRequest): Promise<CreateUserResponse> {
    return await firstValueFrom(this.http.post<CreateUserResponse>(`${this.apiBase}/users`, req));
  }

  async update(id: string, req: UpdateUserRequest): Promise<UserListItem> {
    return await firstValueFrom(this.http.patch<UserListItem>(`${this.apiBase}/users/${id}`, req));
  }

  async getSsn(id: string): Promise<UserSsnResponse> {
    return await firstValueFrom(this.http.get<UserSsnResponse>(`${this.apiBase}/users/${id}/ssn`));
  }

  async updateSsn(id: string, req: UpdateUserSsnRequest): Promise<UserListItem> {
    return await firstValueFrom(this.http.patch<UserListItem>(`${this.apiBase}/users/${id}/ssn`, req));
  }

  /** Admin: send a password-reset email to this user so they can set a new password. */
  async sendPasswordReset(id: string): Promise<void> {
    await firstValueFrom(this.http.post<{ ok: boolean }>(`${this.apiBase}/users/${id}/send-password-reset`, {}));
  }
}
