import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const landingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    return router.parseUrl('/login');
  }

  if (auth.mustCompleteRegistration()) {
    return router.parseUrl('/register');
  }

  return auth.isAdmin() ? router.parseUrl('/admin') : router.parseUrl('/my-cases');
};
