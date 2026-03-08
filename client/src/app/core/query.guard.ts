import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Allows access for Administrator (5), Petitioner Attorney (3), and Legal Assistant (6) — AI query and document query. */
export const queryGuard: CanActivateFn = () => {
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
