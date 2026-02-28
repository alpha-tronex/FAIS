import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ReportsService, type ReportRow } from '../../../services/reports.service';
import { AuthService } from '../../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-report-natural-page',
  templateUrl: './report-natural.page.html',
  styleUrl: './report-natural.page.css',
})
export class ReportNaturalPage {
  prompt = '';
  busy = false;
  error: string | null = null;
  rows: ReportRow[] = [];
  narrative: string | null = null;

  constructor(
    private readonly reports: ReportsService,
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/login');
      return;
    }
    if (!this.auth.hasRole(3, 5)) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }
  }

  get hasNumChildren(): boolean {
    return this.rows.some((r) => r.numChildren != null);
  }

  runReport(): void {
    if (!this.prompt.trim()) {
      this.error = 'Enter a description of the report you want.';
      return;
    }
    this.busy = true;
    this.error = null;
    this.rows = [];
    this.narrative = null;
    this.reports
      .queryNatural(this.prompt)
      .then((res) => {
        this.rows = res.rows;
        this.narrative = res.narrative ?? null;
      })
      .catch((e: { error?: { error?: string }; status?: number }) => {
        if (e?.status === 401) {
          this.auth.logout();
          void this.router.navigateByUrl('/login');
          return;
        }
        if (e?.status === 503) {
          this.error = 'AI report service is not configured. Please contact support.';
          return;
        }
        if (e?.status === 429 || e?.status === 402) {
          this.error =
            'AI report quota exceeded. Check your OpenAI plan and billing at platform.openai.com/account/billing.';
          return;
        }
        this.error = e?.error?.error ?? 'Failed to generate report.';
      })
      .finally(() => {
        this.busy = false;
      });
  }
}
