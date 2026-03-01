import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Allows access to home when logged in and registration is complete. */
export const homeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    return router.parseUrl('/login');
  }

  if (auth.mustCompleteRegistration()) {
    return router.parseUrl('/register');
  }

  return true;
};
