import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, interval, Subject, filter, takeUntil } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export type SessionModalState = {
  visible: boolean;
  /** Seconds remaining until auto-logout (idle countdown). */
  countdownSeconds: number;
};

@Injectable({ providedIn: 'root' })
export class SessionIdleService implements OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private countdownIntervalId: ReturnType<typeof setInterval> | null = null;

  /** Last time the user was considered active (ms). Reset on click, keydown, navigation, API request. */
  private lastActivityAt = 0;
  /** Throttle: only try token refresh at most once per 60s when token is close to expiring. */
  private lastTokenRefreshAt = 0;

  readonly state$ = new BehaviorSubject<SessionModalState>({
    visible: false,
    countdownSeconds: 0
  });

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router
  ) {
    const idleTimeoutMs = environment.sessionIdleTimeoutMs ?? 15 * 60 * 1000;
    const warningSec = environment.sessionIdleWarningSec ?? 120;
    const checkIntervalMs = environment.sessionCheckIntervalMs ?? 30_000;

    if (this.auth.isLoggedIn()) {
      this.lastActivityAt = Date.now();
    }

    // Reset idle timer on user interaction
    if (typeof document !== 'undefined') {
      const events = ['click', 'keydown', 'mousedown', 'touchstart', 'scroll'];
      events.forEach((ev) => {
        document.addEventListener(ev, this.handleActivity);
      });
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.router.events.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.recordActivity();
    });

    interval(checkIntervalMs)
      .pipe(
        filter(() => this.auth.isLoggedIn()),
        takeUntil(this.destroy$)
      )
      .subscribe(() => this.checkIdleAndMaybeShowWarning(idleTimeoutMs, warningSec));

    if (this.auth.isLoggedIn()) {
      setTimeout(() => this.checkIdleAndMaybeShowWarning(idleTimeoutMs, warningSec), 1000);
    }
  }

  private handleActivity = (): void => {
    this.recordActivity();
  };

  /**
   * When the tab becomes visible (e.g. user wakes the computer), if the token is missing
   * but we're on a protected route, redirect to login so the user sees the login page
   * instead of hitting an API and seeing "Missing token" on the current page.
   */
  private handleVisibilityChange = (): void => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    if (this.auth.isLoggedIn()) return;
    const path = this.router.url.split('?')[0] || '';
    const publicPaths = ['/', '/login', '/register', '/reset', '/forgot-password', '/reset-password'];
    const isPublic = publicPaths.some((p) => path === p || path.startsWith(p + '/'));
    if (!isPublic) {
      void this.router.navigateByUrl('/login?session=expired');
    }
  };

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      const events = ['click', 'keydown', 'mousedown', 'touchstart', 'scroll'];
      events.forEach((ev) => {
        document.removeEventListener(ev, this.handleActivity);
      });
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.stopCountdown();
  }

  /**
   * Call when the user is active (click, keydown, navigation, or authenticated API request).
   * Resets the idle timer. Optionally refreshes the token if it is close to expiring.
   */
  recordActivity(): void {
    if (!this.auth.isLoggedIn()) return;
    this.lastActivityAt = Date.now();

    // Optional: keep token alive when user is active and token is close to expiring
    const exp = this.auth.getTokenExpiryTime();
    if (exp != null) {
      const nowSec = Math.floor(Date.now() / 1000);
      const remainingSec = exp - nowSec;
      const refreshThresholdSec = 120;
      const throttleMs = 60_000;
      if (remainingSec < refreshThresholdSec && Date.now() - this.lastTokenRefreshAt > throttleMs) {
        this.lastTokenRefreshAt = Date.now();
        this.auth.refreshToken().catch(() => {});
      }
    }
  }

  private checkIdleAndMaybeShowWarning(idleTimeoutMs: number, warningSec: number): void {
    if (!this.auth.isLoggedIn()) return;

    if (this.lastActivityAt === 0) {
      this.lastActivityAt = Date.now();
      return;
    }

    const idleMs = Date.now() - this.lastActivityAt;
    const idleSec = idleMs / 1000;
    const idleTimeoutSec = idleTimeoutMs / 1000;

    if (idleSec >= idleTimeoutSec) {
      this.auth.logout();
      void this.router.navigateByUrl('/login?session=expired');
      return;
    }

    const remainingUntilTimeoutSec = idleTimeoutSec - idleSec;
    if (remainingUntilTimeoutSec <= warningSec && !this.state$.value.visible) {
      this.showModal(Math.min(Math.floor(remainingUntilTimeoutSec), warningSec));
    }
  }

  private showModal(initialSeconds: number): void {
    this.state$.next({ visible: true, countdownSeconds: initialSeconds });
    this.startCountdown();
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.countdownIntervalId = setInterval(() => {
      const current = this.state$.value;
      if (!current.visible || current.countdownSeconds <= 0) {
        this.stopCountdown();
        return;
      }
      const next = current.countdownSeconds - 1;
      if (next <= 0) {
        this.stopCountdown();
        this.doLogout();
        return;
      }
      this.state$.next({ ...current, countdownSeconds: next });
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownIntervalId != null) {
      clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }
  }

  private doLogout(): void {
    this.state$.next({ visible: false, countdownSeconds: 0 });
    this.auth.logout();
    void this.router.navigateByUrl('/login?session=expired');
  }

  /** User chose "Stay logged in" – refresh token, reset idle timer, and close modal. */
  async stayLoggedIn(): Promise<void> {
    try {
      await this.auth.refreshToken();
      this.recordActivity();
      this.stopCountdown();
      this.state$.next({ visible: false, countdownSeconds: 0 });
    } catch {
      this.doLogout();
    }
  }

  /** User chose "Log out". */
  logOut(): void {
    this.stopCountdown();
    this.doLogout();
  }
}
