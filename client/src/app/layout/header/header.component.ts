import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AppointmentsService } from '../../services/appointments.service';
import type { Subscription } from 'rxjs';

@Component({
  standalone: false,
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})
export class HeaderComponent implements OnInit, OnDestroy {
  /** First name for greeting, or uname fallback; set after me() loads. */
  userDisplayName: string | null = null;
  /** Count of pending actions (accept/reject or reschedule) for the Upcoming Events badge. */
  pendingActionsCount = 0;
  private routerSub: Subscription | null = null;
  private refreshSub: Subscription | null = null;

  constructor(
    private readonly router: Router,
    private readonly auth: AuthService,
    private readonly appointmentsApi: AppointmentsService
  ) {}

  ngOnInit(): void {
    if (this.auth.isLoggedIn()) {
      this.auth.me().then((me) => {
        this.userDisplayName = me.firstName?.trim() || me.uname || null;
      }).catch(() => {
        this.userDisplayName = this.auth.getUnameFromToken();
      });
    }
    if (this.showUpcomingEventsLink) {
      this.loadPendingActionsCount();
    }
    this.routerSub = this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd)
    ).subscribe(() => {
      if (this.auth.isLoggedIn() && this.showUpcomingEventsLink) {
        this.loadPendingActionsCount();
      }
    });
    this.refreshSub = this.appointmentsApi.getPendingActionsRefresh().subscribe(() => {
      if (this.showUpcomingEventsLink) {
        this.loadPendingActionsCount();
      }
    });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
  }

  private loadPendingActionsCount(): void {
    this.appointmentsApi.getPendingActionsCount()
      .then((res) => { this.pendingActionsCount = res.count; })
      .catch(() => { this.fallbackPendingActionsCount(); });
  }

  /** When count endpoint fails (e.g. proxy/parse), derive count from list so badge still works. */
  private fallbackPendingActionsCount(): void {
    const role = this.auth.getRoleTypeIdFromToken();
    if (role === null) {
      this.pendingActionsCount = 0;
      return;
    }
    this.appointmentsApi.list()
      .then((items) => {
        const needPending = role === 1 ? 'pending' : 'reschedule_requested';
        this.pendingActionsCount = items.filter((a) => a.status === needPending).length;
      })
      .catch(() => { this.pendingActionsCount = 0; });
  }

  get isLoggedIn(): boolean {
    return this.auth.isLoggedIn();
  }

  get isAdmin(): boolean {
    return this.auth.isAdmin();
  }

  /** When true, show admin nav (Users | Cases | Affidavit | Upcoming Events) instead of main nav (My cases | Profile | Upcoming Events). */
  get showAdminNav(): boolean {
    return this.isAdmin;
  }

  /** Respondent (2) or Respondent Attorney (4): view-only affidavit from My Cases, no Edit data. */
  get isRespondentViewer(): boolean {
    return this.auth.hasRole(2, 4);
  }

  /** Petitioner (1), Petitioner Attorney (3), Legal Assistant (6), or Admin (5): show Upcoming Events link. */
  get showUpcomingEventsLink(): boolean {
    return this.auth.hasRole(1, 3, 5, 6);
  }

  /** Query params for Profile link: none (profile is own page; do not carry caseId/userId from affidavit). */
  get profileQueryParams(): Record<string, string> {
    return {};
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
