import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Handles 401 responses uniformly: clear session, redirect to login with session=expired
 * (so the login page can show "Your session expired. Please sign in again."), then rethrow.
 * Navigation is awaited before rethrowing so the user is on the login page before any
 * component error handler runs (avoids showing "Missing token" etc. on the previous page).
 */
export const unauthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err?.status === 401) {
        auth.logout();
        return from(router.navigateByUrl('/login?session=expired')).pipe(
          switchMap(() => throwError(() => err))
        );
      }
      return throwError(() => err);
    })
  );
};
