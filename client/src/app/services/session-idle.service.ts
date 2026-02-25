import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, interval, Subject, filter, takeUntil } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export type SessionModalState = {
  visible: boolean;
  /** Seconds remaining until auto-logout. */
  countdownSeconds: number;
};

@Injectable({ providedIn: 'root' })
export class SessionIdleService implements OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private countdownIntervalId: ReturnType<typeof setInterval> | null = null;

  readonly state$ = new BehaviorSubject<SessionModalState>({
    visible: false,
    countdownSeconds: 0
  });

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router
  ) {
    const checkIntervalMs = environment.sessionCheckIntervalMs ?? 30_000;
    interval(checkIntervalMs)
      .pipe(
        filter(() => this.auth.isLoggedIn()),
        takeUntil(this.destroy$)
      )
      .subscribe(() => this.checkAndMaybeShowWarning());

    // Run one check soon after init (when logged in)
    if (this.auth.isLoggedIn()) {
      setTimeout(() => this.checkAndMaybeShowWarning(), 1000);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopCountdown();
  }

  private checkAndMaybeShowWarning(): void {
    if (!this.auth.isLoggedIn()) return;

    const exp = this.auth.getTokenExpiryTime();
    if (exp == null) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const remainingSec = exp - nowSec;

    if (remainingSec <= 0) {
      this.auth.logout();
      void this.router.navigateByUrl('/login?session=expired');
      return;
    }

    const warningSec = environment.sessionWarningBeforeExpirySec ?? 120;
    if (remainingSec <= warningSec && !this.state$.value.visible) {
      this.showModal(Math.min(remainingSec, warningSec));
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

  /** User chose "Stay logged in" – refresh token and close modal. */
  async stayLoggedIn(): Promise<void> {
    try {
      await this.auth.refreshToken();
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
