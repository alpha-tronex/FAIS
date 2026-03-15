import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Blocks respondent (2) and respondent attorney (4) from the child support worksheet edit page.
 */
export const childSupportWorksheetEditGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.hasRole(2, 4)) {
    return router.parseUrl('/my-cases');
  }

  return true;
};
