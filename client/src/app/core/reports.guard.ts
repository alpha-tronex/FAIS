import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Petitioner Attorney (3), Legal Assistant (6), or Administrator (5) may access report pages. */
export const reportsGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    return router.parseUrl('/login');
  }

  if (auth.mustCompleteRegistration()) {
    return router.parseUrl('/register');
  }

  if (!auth.hasRole(3, 5, 6)) {
    return router.parseUrl('/my-cases');
  }

  return true;
};
