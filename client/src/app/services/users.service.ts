import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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
  uname: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
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
  private readonly apiBase = 'http://localhost:3001';

  constructor(private readonly http: HttpClient) {}

  list(): Observable<UserListItem[]> {
    return this.http.get<UserListItem[]>(`${this.apiBase}/users`);
  }

  get(id: string): Observable<UserListItem> {
    return this.http.get<UserListItem>(`${this.apiBase}/users/${id}`);
  }

  create(req: CreateUserRequest): Observable<CreateUserResponse> {
    return this.http.post<CreateUserResponse>(`${this.apiBase}/users`, req);
  }

  update(id: string, req: UpdateUserRequest): Observable<UserListItem> {
    return this.http.patch<UserListItem>(`${this.apiBase}/users/${id}`, req);
  }

  getSsn(id: string): Observable<UserSsnResponse> {
    return this.http.get<UserSsnResponse>(`${this.apiBase}/users/${id}/ssn`);
  }

  updateSsn(id: string, req: UpdateUserSsnRequest): Observable<UserListItem> {
    return this.http.patch<UserListItem>(`${this.apiBase}/users/${id}/ssn`, req);
  }
}
