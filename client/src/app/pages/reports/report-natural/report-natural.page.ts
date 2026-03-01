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
  aboutUserSummary: { bullets: string[] } | null = null;

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
    if (!this.auth.hasRole(3, 5, 6)) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }
  }

  get hasNumChildren(): boolean {
    return this.rows.some((r) => r.numChildren != null);
  }

  get aboutBulletItems(): { label: string; value: string }[] {
    if (!this.aboutUserSummary?.bullets?.length) return [];
    return this.aboutUserSummary.bullets.map((b) => {
      const i = b.indexOf(':** ');
      if (i === -1) return { label: b.replace(/\*\*/g, ''), value: '' };
      return { label: b.slice(0, i).replace(/\*\*/g, ''), value: b.slice(i + 4) };
    });
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
    this.aboutUserSummary = null;
    this.reports
      .queryNatural(this.prompt)
      .then((res) => {
        this.rows = res.rows ?? [];
        this.narrative = res.narrative ?? null;
        this.aboutUserSummary = res.aboutUserSummary ?? null;
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
