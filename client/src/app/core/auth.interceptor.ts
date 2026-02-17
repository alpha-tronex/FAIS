import { HttpInterceptorFn } from '@angular/common/http';

const TOKEN_KEY = 'fais_token';
const MUST_RESET_PASSWORD_KEY = 'fais_must_reset_password';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return next(req);

  return next(
    req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    })
  );
};

export function setToken(token: string | null) {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setMustResetPassword(mustResetPassword: boolean | null) {
  if (mustResetPassword === null) {
    localStorage.removeItem(MUST_RESET_PASSWORD_KEY);
    return;
  }
  localStorage.setItem(MUST_RESET_PASSWORD_KEY, mustResetPassword ? '1' : '0');
}

export function getMustResetPassword(): boolean {
  return localStorage.getItem(MUST_RESET_PASSWORD_KEY) === '1';
}
