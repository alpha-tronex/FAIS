import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AffidavitService, AffidavitSummary } from '../../services/affidavit.service';

@Component({
  standalone: false,
  selector: 'app-affidavit-page',
  templateUrl: './affidavit.page.html',
  styleUrl: './affidavit.page.css'
})
export class AffidavitPage implements OnInit, OnDestroy {
  summary: AffidavitSummary | null = null;
  userId: string | null = null;

  busy = false;
  pdfBusy = false;
  error: string | null = null;

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly affidavitApi: AffidavitService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
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

    this.refresh();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  refresh() {
    this.subscription?.unsubscribe();

    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(this.affidavitApi.summary(this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (summary) => {
          this.summary = summary;
          this.cdr.markForCheck();
        },
        error: (e: any) => {
          this.summary = null;
          this.error = e?.error?.error ?? 'Failed to load affidavit summary';
          this.cdr.markForCheck();
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
    this.cdr.markForCheck();

    try {
      const blob = await this.affidavitApi.generatePdf('auto', this.userId || undefined);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financial-affidavit-${this.summary?.form ?? 'auto'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to generate PDF';
      if (e?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.pdfBusy = false;
      this.cdr.markForCheck();
    }
  }
}
