import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Handles 401 responses uniformly: clear session and redirect to login with session=expired
 * so the login page can show "Your session expired. Please sign in again."
 */
export const unauthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err?.status === 401) {
        auth.logout();
        void router.navigateByUrl('/login?session=expired');
      }
      return throwError(() => err);
    })
  );
};
