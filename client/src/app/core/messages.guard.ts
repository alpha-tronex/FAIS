import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Allows access only for Petitioner (1), Petitioner Attorney (3), Legal Assistant (6), and Administrator (5).
 * Respondents and Respondent Attorneys cannot use messaging.
 */
export const messagesGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    return router.parseUrl('/login');
  }

  if (auth.mustCompleteRegistration()) {
    return router.parseUrl('/register');
  }

  if (!auth.hasRole(1, 3, 5, 6)) {
    return router.parseUrl('/my-cases');
  }

  return true;
};
