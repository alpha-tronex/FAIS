import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

/**
 * Legacy route: /admin/child-support-worksheet → admin affidavit (worksheet actions live there).
 */
@Component({
  standalone: false,
  selector: 'app-admin-child-support-worksheet-page',
  template: '<p class="mt16 muted">Redirecting to Admin affidavit…</p>'
})
export class AdminChildSupportWorksheetPage implements OnInit {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/login');
      return;
    }
    if (!this.auth.isAdmin()) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }
    const userId = this.route.snapshot.queryParamMap.get('userId');
    const caseId = this.route.snapshot.queryParamMap.get('caseId');
    const queryParams: Record<string, string> = {};
    if (userId) queryParams['userId'] = userId;
    if (caseId) queryParams['caseId'] = caseId;
    void this.router.navigate(['/admin', 'affidavit'], { queryParams });
  }
}
