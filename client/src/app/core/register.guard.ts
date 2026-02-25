import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Allows access to /register only for invited users who must complete registration
 * (logged in with mustResetPassword). Others are redirected to login or their landing.
 */
export const registerGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    return router.parseUrl('/login');
  }

  if (!auth.mustCompleteRegistration()) {
    return auth.isAdmin() ? router.parseUrl('/admin') : router.parseUrl('/my-cases');
  }

  return true;
};
