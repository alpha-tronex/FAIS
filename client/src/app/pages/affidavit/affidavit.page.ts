import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import {
  AffidavitService,
  type AffidavitSummary,
  type AffidavitSummaryCaseWorksheet
} from '../../services/affidavit.service';
import { ChildSupportWorksheetService } from '../../services/child-support-worksheet.service';
import { CasesService } from '../../services/cases.service';
import { FileSaveService } from '../../services/file-save.service';

@Component({
  standalone: false,
  selector: 'app-affidavit-page',
  templateUrl: './affidavit.page.html',
  styleUrl: './affidavit.page.css'
})
export class AffidavitPage implements OnInit, OnDestroy {
  summary: AffidavitSummary | null = null;
  userId: string | null = null;
  caseId: string | null = null;

  busy = false;
  pdfBusy = false;
  worksheetPdfBusy = false;
  error: string | null = null;

  subscription: Subscription | null = null;
  /** Keeps `caseId` / `userId` in sync when only query params change (same route reuse). */
  private routeParamsSub: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly affidavitApi: AffidavitService,
    private readonly worksheetApi: ChildSupportWorksheetService,
    private readonly casesApi: CasesService,
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

      if (this.isRespondentViewer && !this.caseId) {
        void this.router.navigateByUrl('/my-cases');
        return;
      }

      this.refresh();
    });
  }

  /** Respondent (2) or Respondent Attorney (4): view-only petitioner's affidavit, HTML print only. */
  get isRespondentViewer(): boolean {
    return this.auth.hasRole(2, 4);
  }

  /** Official worksheet PDF: same policy as `GET /child-support-worksheet/pdf` (roles 3, 5, 6). */
  get canOfficialWorksheetPdf(): boolean {
    return this.auth.hasRole(3, 5, 6);
  }

  /** Official financial affidavit PDF: same policy as `GET /affidavit/pdf` (roles 3, 5, 6). */
  get canOfficialAffidavitPdf(): boolean {
    return this.auth.hasRole(3, 5, 6);
  }

  /** Petitioner-side roles return to affidavit editor from summary (when case context exists). */
  get showBackToAffidavitEdit(): boolean {
    return Boolean(this.caseId) && !this.isRespondentViewer && this.auth.hasRole(1, 3, 6);
  }

  /** True when back link should go to My cases (respondent-side and non-editor contexts). */
  get showBackToMyCases(): boolean {
    if (this.showBackToAffidavitEdit) return false;
    return this.isRespondentViewer || !this.auth.isAdmin();
  }

  /** Admin, attorney (1), petitioner (3), co-petitioner (6): may set worksheet-filed on the case. */
  get canEditChildSupportWorksheetFiled(): boolean {
    return this.auth.isAdmin() || this.auth.hasRole(1, 3, 6);
  }

  /**
   * Worksheet gating from `/affidavit/summary` (same `canSeeCase` as `GET /cases/:id`), avoiding a second request that could fail silently.
   */
  private get worksheetCaseGate(): AffidavitSummaryCaseWorksheet | null {
    const cw = this.summary?.caseWorksheet;
    if (!this.caseId || !cw) return null;
    const a = this.caseId.trim().toLowerCase();
    const b = cw.caseId.trim().toLowerCase();
    if (a !== b) return null;
    return cw;
  }

  /** Worksheet links/PDF only when case has children and worksheet-filed is Yes. */
  get showWorksheetPanel(): boolean {
    const w = this.worksheetCaseGate;
    return Boolean(this.caseId) && w != null && w.numChildren > 0 && w.childSupportWorksheetFiled === true;
  }

  /**
   * Case has children but worksheet not marked filed; eligible users can set the flag here.
   */
  get showWorksheetCasePrompt(): boolean {
    if (!this.caseId || this.isRespondentViewer || !this.canEditChildSupportWorksheetFiled) {
      return false;
    }
    const w = this.worksheetCaseGate;
    if (w == null) return false;
    return w.numChildren > 0 && w.childSupportWorksheetFiled !== true;
  }

  get worksheetFiledSelectValue(): boolean | null {
    const w = this.worksheetCaseGate;
    if (!w) return null;
    const v = w.childSupportWorksheetFiled;
    if (v === true) return true;
    if (v === false) return false;
    return null;
  }

  navQueryParams(): Record<string, string> {
    const qp: Record<string, string> = {};
    if (this.userId) qp['userId'] = this.userId;
    if (this.caseId) qp['caseId'] = this.caseId;
    return qp;
  }

  /** Child support worksheet: tells the worksheet page to offer a back link to this summary. */
  worksheetNavQueryParams(): Record<string, string> {
    return { ...this.navQueryParams(), from: 'affidavit' };
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.routeParamsSub?.unsubscribe();
  }

  refresh() {
    this.subscription?.unsubscribe();

    this.busy = true;
    this.error = null;

    const summaryUserId = this.userId || undefined;
    const summaryCaseId = this.caseId || undefined;

    this.subscription = from(this.affidavitApi.summary(summaryUserId, summaryCaseId))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (summary) => {
          this.summary = summary;
          const cw = summary.caseWorksheet;
        },
        error: (e: any) => {
          this.summary = null;
          this.error = e?.error?.error ?? 'Failed to load affidavit summary';
          if (e?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  async onWorksheetFiledModelChange(value: boolean | null): Promise<void> {
    if (!this.caseId || !this.canEditChildSupportWorksheetFiled) return;
    this.error = null;
    try {
      await this.casesApi.patchChildSupportWorksheetFiled(this.caseId, value);
      this.summary = await this.affidavitApi.summary(this.userId || undefined, this.caseId || undefined);
    } catch (e: unknown) {
      const err = e as { error?: { error?: string }; status?: number };
      this.error = err?.error?.error ?? 'Failed to update worksheet filing flag';
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    }
  }

  goBack() {
    void this.router.navigateByUrl(this.isRespondentViewer || !this.auth.isAdmin() ? '/my-cases' : '/admin/users');
  }

  logout() {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  async generateWorksheetPdf(): Promise<void> {
    if (!this.canOfficialWorksheetPdf) return;
    if (!this.showWorksheetPanel || this.worksheetPdfBusy || this.pdfBusy || this.busy) return;
    this.worksheetPdfBusy = true;
    this.error = null;
    try {
      const blob = await this.worksheetApi.generatePdf(this.userId || undefined, this.caseId || undefined);
      await this.fileSave.savePdf(blob, 'child-support-guidelines-worksheet.pdf');
    } catch (e: unknown) {
      const err = e as { error?: { error?: string }; status?: number };
      this.error = err?.error?.error ?? 'Failed to generate worksheet PDF';
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.worksheetPdfBusy = false;
    }
  }

  async generatePdf() {
    if (this.pdfBusy) return;
    this.pdfBusy = true;
    this.error = null;

    try {
      const form = this.summary?.form ?? 'auto';
      const blob = await this.affidavitApi.generatePdf(
        form,
        this.userId || undefined,
        this.caseId || undefined
      );
      const fileName = this.isRespondentViewer
        ? 'financial-affidavit-summary.pdf'
        : `financial-affidavit-${this.summary?.form ?? 'auto'}.pdf`;
      await this.fileSave.savePdf(blob, fileName);
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to generate PDF';
      if (e?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.pdfBusy = false;
    }
  }
}
