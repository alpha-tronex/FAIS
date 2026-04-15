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

  /** Respondent / respondent attorney: editable worksheet income (saved to case worksheet). */
  respondentGross: number | null = null;
  respondentNet: number | null = null;
  saveIncomeBusy = false;
  saveIncomeSuccess = false;

  subscription: Subscription | null = null;
  private routeParamsSub: Subscription | null = null;

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

    this.routeParamsSub = this.route.queryParamMap.subscribe((params) => {
      const qpUserId = params.get('userId')?.trim();
      if (qpUserId) {
        if (!this.auth.isAdmin()) {
          void this.router.navigateByUrl('/my-cases');
          return;
        }
        this.userId = qpUserId;
      } else {
        this.userId = null;
      }

      const qpCaseId = params.get('caseId')?.trim() || null;
      this.caseId = qpCaseId;

      if (this.auth.hasRole(3, 6) && !this.caseId) {
        void this.router.navigateByUrl('/my-cases');
        return;
      }

      if (this.isRespondentViewer && !this.caseId) {
        void this.router.navigateByUrl('/my-cases');
        return;
      }

      this.refresh();
    });
  }

  get isRespondentViewer(): boolean {
    return this.auth.hasRole(2, 4);
  }

  get isRespondentAttorney(): boolean {
    return this.auth.hasRole(4);
  }

  get showBackToMyCases(): boolean {
    return this.isRespondentViewer || !this.auth.isAdmin();
  }

  /** Matches server-side official worksheet PDF role gate. */
  get canGetOfficialPdf(): boolean {
    return this.auth.hasRole(3, 5, 6);
  }

  navQueryParams(): Record<string, string> {
    const qp: Record<string, string> = {};
    if (this.userId) qp['userId'] = this.userId;
    if (this.caseId) qp['caseId'] = this.caseId;
    return qp;
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.routeParamsSub?.unsubscribe();
  }

  private syncRespondentIncomeFromWorksheet(summary: ChildSupportWorksheetSummary): void {
    const w = summary.worksheet;
    if (!w) {
      this.respondentGross = null;
      this.respondentNet = null;
      return;
    }
    const g = w.parentBMonthlyGrossIncome;
    const n = w.parentBMonthlyNetIncome;
    this.respondentGross = g != null && Number.isFinite(Number(g)) ? Number(g) : null;
    this.respondentNet = n != null && Number.isFinite(Number(n)) ? Number(n) : null;
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
          this.syncRespondentIncomeFromWorksheet(summary);
        },
        error: (e: unknown) => {
          this.summary = null;
          const err = e as { error?: { error?: string }; status?: number };
          if (err?.status === 403) {
            this.error =
              err?.error?.error ??
              'The worksheet is not enabled for this case. Set the case field Worksheet filed to Yes when a guidelines worksheet applies (My cases, affidavit pages, or Cases admin).';
          } else {
            this.error = err?.error?.error ?? 'Failed to load worksheet summary';
          }
          if (err?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  goBack(): void {
    if (this.isRespondentViewer || !this.auth.isAdmin()) {
      void this.router.navigateByUrl('/my-cases');
    } else {
      void this.router.navigate(['/admin', 'affidavit'], { queryParams: this.navQueryParams() });
    }
  }

  async saveRespondentIncome(): Promise<void> {
    if (!this.isRespondentViewer || !this.caseId || this.saveIncomeBusy) return;
    this.saveIncomeBusy = true;
    this.error = null;
    this.saveIncomeSuccess = false;

    const payload: { parentBMonthlyGrossIncome?: number; parentBMonthlyNetIncome?: number } = {};
    if (this.respondentGross != null && Number.isFinite(this.respondentGross) && this.respondentGross >= 0) {
      payload.parentBMonthlyGrossIncome = this.respondentGross;
    }
    if (this.respondentNet != null && Number.isFinite(this.respondentNet) && this.respondentNet >= 0) {
      payload.parentBMonthlyNetIncome = this.respondentNet;
    }
    if (Object.keys(payload).length === 0) {
      this.error = 'Enter at least one value: monthly gross income and/or monthly net income (non-negative numbers).';
      this.saveIncomeBusy = false;
      return;
    }

    try {
      await this.worksheetApi.saveRespondentIncomeFields(payload, this.caseId);
      this.saveIncomeSuccess = true;
      this.refresh();
    } catch (e: unknown) {
      const err = e as { error?: { error?: string }; status?: number };
      this.error = err?.error?.error ?? 'Failed to save income';
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.saveIncomeBusy = false;
    }
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
      if (err?.status === 403) {
        this.error =
          err?.error?.error ??
          'Official worksheet PDF is unavailable for this role. Use Print (HTML) instead.';
      } else {
        this.error = err?.error?.error ?? 'Failed to generate PDF';
      }
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.pdfBusy = false;
    }
  }

  printFriendlyHtml(): void {
    window.print();
  }
}
