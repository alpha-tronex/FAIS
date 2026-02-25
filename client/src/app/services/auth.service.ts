import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { getMustResetPassword, getToken, setMustResetPassword, setToken } from '../core/auth.interceptor';

export type LoginResponse = {
  token: string;
  mustResetPassword: boolean;
  user: {
    id: string;
    uname: string;
    roleTypeId: number;
  };
};

export type RegisterRequest = {
  uname: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  ssn: string;
};

export type MeResponse = {
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

export type MySsnResponse = {
  ssn: string;
  ssnLast4?: string;
};

export type UpdateMySsnRequest = {
  ssn: string;
  confirmSsn: string;
};

export type UpdateMeRequest = {
  email?: string;
  firstName?: string;
  lastName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
};

type JwtPayload = {
  sub?: string;
  roleTypeId?: number | string;
  uname?: string;
  exp?: number;
  iat?: number;
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  isLoggedIn(): boolean {
    return Boolean(getToken());
  }

  mustCompleteRegistration(): boolean {
    return this.isLoggedIn() && getMustResetPassword();
  }

  /**
   * Best-effort JWT decode (no signature validation) to read roleTypeId.
   * This is used for UI gating so we don't depend on /me succeeding.
   */
  getRoleTypeIdFromToken(): number | null {
    const token = getToken();
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
      const json = globalThis.atob(base64);
      const payload = JSON.parse(json) as JwtPayload;
      const raw = payload?.roleTypeId;
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  getUnameFromToken(): string | null {
    const token = getToken();
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
      const json = globalThis.atob(base64);
      const payload = JSON.parse(json) as JwtPayload;
      return typeof payload?.uname === 'string' ? payload.uname : null;
    } catch {
      return null;
    }
  }

  isAdmin(): boolean {
    return this.getRoleTypeIdFromToken() === 5;
  }

  hasRole(...roleTypeIds: number[]): boolean {
    const roleTypeId = this.getRoleTypeIdFromToken();
    if (roleTypeId === null) return false;
    return roleTypeIds.includes(roleTypeId);
  }

  isStaffOrAdmin(): boolean {
    // Simplified model: only Administrator has elevated permissions.
    return this.hasRole(5);
  }

  async login(uname: string, password: string): Promise<LoginResponse> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${this.apiBase}/auth/login`, { uname, password })
    );
    setToken(res.token);
    setMustResetPassword(Boolean(res.mustResetPassword));
    return res;
  }

  async register(req: RegisterRequest): Promise<LoginResponse> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${this.apiBase}/auth/register`, req)
    );
    setToken(res.token);
    setMustResetPassword(Boolean(res.mustResetPassword));
    return res;
  }

  async changePassword(newPassword: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.apiBase}/auth/change-password`, { newPassword }));
    setMustResetPassword(false);
  }

  /** Request a password-reset email. Always returns; does not reveal whether email exists. */
  async forgotPassword(email: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiBase}/auth/forgot-password`, { email: email.trim() })
    );
  }

  /** Set new password using the token from the reset email. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiBase}/auth/reset-password`, { token, newPassword })
    );
  }

  logout() {
    setToken(null);
    setMustResetPassword(null);
  }

  async me(): Promise<MeResponse> {
    return await firstValueFrom(this.http.get<MeResponse>(`${this.apiBase}/me`));
  }

  async updateMe(req: UpdateMeRequest): Promise<MeResponse> {
    return await firstValueFrom(this.http.patch<MeResponse>(`${this.apiBase}/me`, req));
  }

  async mySsn(): Promise<MySsnResponse> {
    return await firstValueFrom(this.http.get<MySsnResponse>(`${this.apiBase}/me/ssn`));
  }

  async updateMySsn(req: UpdateMySsnRequest): Promise<MeResponse> {
    return await firstValueFrom(this.http.patch<MeResponse>(`${this.apiBase}/me/ssn`, req));
  }
}
