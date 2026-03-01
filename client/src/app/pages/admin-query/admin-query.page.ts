import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AdminQueryService } from '../../services/admin-query.service';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-admin-query-page',
  templateUrl: './admin-query.page.html',
  styleUrl: './admin-query.page.css',
})
export class AdminQueryPage {
  question = '';
  busy = false;
  error: string | null = null;
  results: unknown[] = [];
  count = 0;
  /** True after at least one successful response (so we can show "No documents match" vs initial hint). */
  ranOnce = false;

  constructor(
    private readonly adminQuery: AdminQueryService,
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/login');
      return;
    }
    if (!this.auth.isAdmin()) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }
  }

  runQuery(): void {
    if (!this.question.trim()) {
      this.error = 'Enter a question.';
      return;
    }
    this.busy = true;
    this.error = null;
    this.results = [];
    this.count = 0;
    this.adminQuery
      .query(this.question)
      .then((res) => {
        this.ranOnce = true;
        this.results = res.results ?? [];
        this.count = res.count ?? 0;
      })
      .catch((e: { error?: { error?: string }; status?: number }) => {
        if (e?.status === 401) {
          this.auth.logout();
          void this.router.navigateByUrl('/login');
          return;
        }
        if (e?.status === 403) {
          this.error = 'Access denied. Admin only.';
          return;
        }
        if (e?.status === 503) {
          this.error = 'AI query service is not configured. Please contact support.';
          return;
        }
        if (e?.status === 429 || e?.status === 402) {
          this.error =
            'AI quota exceeded. Check your OpenAI plan and billing at platform.openai.com/account/billing.';
          return;
        }
        this.error = e?.error?.error ?? 'Query failed.';
      })
      .finally(() => {
        this.busy = false;
      });
  }
}
