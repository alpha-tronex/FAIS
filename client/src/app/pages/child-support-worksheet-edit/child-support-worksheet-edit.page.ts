import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import {
  ChildSupportWorksheetService,
  WorksheetData
} from '../../services/child-support-worksheet.service';

@Component({
  standalone: false,
  selector: 'app-child-support-worksheet-edit-page',
  templateUrl: './child-support-worksheet-edit.page.html',
  styleUrl: './child-support-worksheet-edit.page.css'
})
export class ChildSupportWorksheetEditPage implements OnInit, OnDestroy {
  userId: string | null = null;
  caseId: string | null = null;

  data: WorksheetData = {};
  busy = false;
  saveBusy = false;
  error: string | null = null;
  saveSuccess = false;

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly worksheetApi: ChildSupportWorksheetService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/login');
      return;
    }

    const qpUserId = this.route.snapshot.queryParamMap.get('userId');
    if (qpUserId) {
      if (!this.auth.isAdmin()) {
        void this.router.navigateByUrl('/my-cases');
        return;
      }
      this.userId = qpUserId;
    }

    const qpCaseId = this.route.snapshot.queryParamMap.get('caseId');
    if (qpCaseId) {
      this.caseId = qpCaseId;
    }

    if (this.auth.hasRole(3, 6) && !this.caseId) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }

    if (this.auth.hasRole(2, 4)) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }

    this.load();
  }

  navQueryParams(): Record<string, string> {
    const qp: Record<string, string> = {};
    if (this.userId) qp['userId'] = this.userId;
    if (this.caseId) qp['caseId'] = this.caseId;
    return qp;
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  load(): void {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.worksheetApi.getWorksheet(this.userId || undefined, this.caseId || undefined)
    )
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: (res) => {
          this.data = { ...(res.data || {}) };
        },
        error: (e: unknown) => {
          const err = e as { error?: { error?: string }; status?: number };
          this.error = err?.error?.error ?? 'Failed to load worksheet';
          if (err?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  async save(): Promise<void> {
    if (this.saveBusy) return;
    this.saveBusy = true;
    this.error = null;
    this.saveSuccess = false;

    try {
      await this.worksheetApi.saveWorksheet(
        this.data,
        this.userId || undefined,
        this.caseId || undefined
      );
      this.saveSuccess = true;
    } catch (e: unknown) {
      const err = e as { error?: { error?: string }; status?: number };
      this.error = err?.error?.error ?? 'Failed to save worksheet';
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.saveBusy = false;
    }
  }

  goBack(): void {
    void this.router.navigate(['/child-support-worksheet'], {
      queryParams: this.navQueryParams()
    });
  }
}
