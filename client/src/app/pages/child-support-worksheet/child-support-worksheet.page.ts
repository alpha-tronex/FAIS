import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import {
  ChildSupportWorksheetService,
  ChildSupportWorksheetSummary
} from '../../services/child-support-worksheet.service';
import { FileSaveService } from '../../services/file-save.service';

@Component({
  standalone: false,
  selector: 'app-child-support-worksheet-page',
  templateUrl: './child-support-worksheet.page.html',
  styleUrl: './child-support-worksheet.page.css'
})
export class ChildSupportWorksheetPage implements OnInit, OnDestroy {
  summary: ChildSupportWorksheetSummary | null = null;
  userId: string | null = null;
  caseId: string | null = null;

  busy = false;
  pdfBusy = false;
  error: string | null = null;

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly worksheetApi: ChildSupportWorksheetService,
    private readonly fileSave: FileSaveService,
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

    if (this.isRespondentViewer && !this.caseId) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }

    this.refresh();
  }

  get isRespondentViewer(): boolean {
    return this.auth.hasRole(2, 4);
  }

  get showBackToMyCases(): boolean {
    return this.isRespondentViewer || !this.auth.isAdmin();
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

  formatPercent(value: number | null | undefined): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0.00%';
    return `${(n * 100).toFixed(2)}%`;
  }

  refresh(): void {
    this.subscription?.unsubscribe();

    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.worksheetApi.summary(this.userId || undefined, this.caseId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (summary) => {
          this.summary = summary;
        },
        error: (e: unknown) => {
          this.summary = null;
          const err = e as { error?: { error?: string }; status?: number };
          this.error = err?.error?.error ?? 'Failed to load worksheet summary';
          if (err?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  goBack(): void {
    void this.router.navigateByUrl(
      this.isRespondentViewer || !this.auth.isAdmin() ? '/my-cases' : '/admin/child-support-worksheet'
    );
  }

  async generatePdf(): Promise<void> {
    if (this.pdfBusy) return;
    this.pdfBusy = true;
    this.error = null;

    try {
      const blob = await this.worksheetApi.generatePdf(
        this.userId || undefined,
        this.caseId || undefined
      );
      await this.fileSave.savePdf(blob, 'child-support-guidelines-worksheet.pdf');
    } catch (e: unknown) {
      const err = e as { error?: { error?: string }; status?: number };
      this.error = err?.error?.error ?? 'Failed to generate PDF';
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.pdfBusy = false;
    }
  }
}
