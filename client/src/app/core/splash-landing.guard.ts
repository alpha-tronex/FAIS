import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** For the public landing (splash) at ''. If user is logged in, redirect to home or register; otherwise allow. */
export const splashLandingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    return true;
  }

  if (auth.mustCompleteRegistration()) {
    return router.parseUrl('/register');
  }

  return router.parseUrl('/home');
};
