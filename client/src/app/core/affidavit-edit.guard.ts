import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Blocks respondent (2) and respondent attorney (4) from the affidavit edit page.
 * They may only view the petitioner's affidavit summary and print HTML.
 */
export const affidavitEditGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.hasRole(2, 4)) {
    return router.parseUrl('/my-cases');
  }

  return true;
};
