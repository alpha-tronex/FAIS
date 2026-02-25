import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})
export class HeaderComponent implements OnInit {
  /** First name for greeting, or uname fallback; set after me() loads. */
  userDisplayName: string | null = null;

  constructor(
    private readonly router: Router,
    private readonly auth: AuthService
  ) {}

  ngOnInit(): void {
    if (this.auth.isLoggedIn()) {
      this.auth.me().then((me) => {
        this.userDisplayName = me.firstName?.trim() || me.uname || null;
      }).catch(() => {
        this.userDisplayName = this.auth.getUnameFromToken();
      });
    }
  }

  get isLoggedIn(): boolean {
    return this.auth.isLoggedIn();
  }

  get isAdmin(): boolean {
    return this.auth.isAdmin();
  }

  /** When true, show admin nav (Users | Cases | Affidavit) instead of main nav. */
  get showAdminNav(): boolean {
    return this.isAdmin && this.router.url.split('?')[0].startsWith('/admin');
  }

  /** Respondent (2) or Respondent Attorney (4): view-only affidavit from My Cases, no Edit data. */
  get isRespondentViewer(): boolean {
    return this.auth.hasRole(2, 4);
  }

  /** Current route query params to preserve in nav links (caseId, userId). */
  get navQueryParams(): Record<string, string> {
    const q = this.router.parseUrl(this.router.url).queryParams;
    const out: Record<string, string> = {};
    if (q['caseId']) out['caseId'] = Array.isArray(q['caseId']) ? q['caseId'][0] : q['caseId'];
    if (q['userId']) out['userId'] = Array.isArray(q['userId']) ? q['userId'][0] : q['userId'];
    return out;
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
