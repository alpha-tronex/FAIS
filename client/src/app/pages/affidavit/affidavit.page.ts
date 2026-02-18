import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AffidavitService, AffidavitSummary } from '../../services/affidavit.service';
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
  error: string | null = null;

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly affidavitApi: AffidavitService,
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

    this.refresh();
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

  refresh() {
    this.subscription?.unsubscribe();

    this.busy = true;
    this.error = null;

    this.subscription = from(this.affidavitApi.summary(this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (summary) => {
          this.summary = summary;
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

  goBack() {
    void this.router.navigateByUrl(this.auth.isAdmin() ? '/admin' : '/my-cases');
  }

  logout() {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  async generatePdf() {
    if (this.pdfBusy) return;
    this.pdfBusy = true;
    this.error = null;

    try {
      const blob = await this.affidavitApi.generateOfficialPdf('auto', this.userId || undefined, this.caseId || undefined);
      const fileName = `financial-affidavit-${this.summary?.form ?? 'auto'}.pdf`;
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
