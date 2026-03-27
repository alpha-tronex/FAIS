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
  summary: string | null = null;
  /** When set, display summary as ul/li list (e.g. "3 counties with highest income"). */
  summaryList: string[] = [];
  /** When set, display as sections with title + ul/li (e.g. affidavit data by petitioner). */
  summarySections: { title: string; items: string[] }[] = [];
  results: unknown[] = [];
  count = 0;
  /** True after at least one successful response (so we can show "No documents match" vs initial hint). */
  ranOnce = false;
  /** True when the server returned a clarification request (ambiguous question). */
  clarification = false;
  /** User's response to the clarification question (shown in input when clarification is true). */
  clarificationResponse = '';
  /** Toggle to show/hide raw JSON results. */
  showRawResults = false;
  answer: {
    plainEnglishSummary: string;
    list: {
      applies: boolean;
      columns: string[];
      rows: unknown[];
      truncated: boolean;
      rowLimit: number;
    };
    aggregate: {
      applies: boolean;
      metrics: { name: string; value: number | string; unit: 'count' | 'usd' | 'percent' | 'other' }[];
      breakdowns: { dimension: string; buckets: { key: string; value: number | string }[] }[];
    };
    caveats: string[];
    queryUsed: string;
    resultMeta: {
      queryType: 'find' | 'aggregate';
      intent: 'list' | 'aggregate' | 'both' | 'clarify';
      rowCountReturned: number;
      executionMs: number;
      executionNote: string;
      validationFailed: boolean;
    };
  } | null = null;

  telemetry: {
    totals: {
      requests: number;
      clarifications: number;
      validationFailures: number;
      success: number;
    };
    intent: Record<'list' | 'aggregate' | 'both' | 'clarify', number>;
    queryType: Record<'find' | 'aggregate', number>;
  } | null = null;
  telemetryError: string | null = null;
  /** True briefly after copying answer to clipboard. */
  copied = false;

  /** Fallback when the suggestions API fails. */
  private static readonly fallbackSuggestions = [
    'List all monthly income types.',
    'Find the total monthly household expenses for a specific user (e.g., John Doe).',
    'List all petitioners and their associated case numbers.',
    'Find the average market value of all assets.',
    'List the 3 counties with the highest amount of assets',
  ];

  /** Currently displayed suggestions (from API: static + ai_query_examples, random 5). */
  suggestedQuestions: string[] = [];
  readonly suggestionCount = 5;
  suggestionsLoading = false;

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
    if (!this.auth.hasRole(3, 5, 6)) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }
    this.refreshSuggestions();
    this.refreshTelemetry();
  }

  /** Fetch a new random set of 5 suggestions from the server (static + ai_query_examples). */
  refreshSuggestions(): void {
    this.suggestionsLoading = true;
    this.adminQuery
      .getSuggestions(this.suggestionCount)
      .then((res) => {
        this.suggestedQuestions = res.questions ?? [];
      })
      .catch(() => {
        this.suggestedQuestions = [...AdminQueryPage.fallbackSuggestions];
      })
      .finally(() => {
        this.suggestionsLoading = false;
      });
  }

  runQuery(options?: { skipClarification?: boolean }): void {
    if (!this.question.trim()) {
      this.error = 'Enter a question.';
      return;
    }
    this.busy = true;
    this.error = null;
    this.summary = null;
    this.summaryList = [];
    this.summarySections = [];
    this.results = [];
    this.count = 0;
    this.clarification = false;
    this.clarificationResponse = '';
    this.answer = null;
    this.adminQuery
      .query(this.question, options)
      .then((res) => {
        this.ranOnce = true;
        if (res.answer) {
          this.answer = res.answer;
        }
        if (res.clarification) {
          this.summary = res.answer?.plainEnglishSummary ?? res.clarification;
          this.results = res.results ?? [];
          this.count = res.count ?? 0;
          this.clarification = true;
        } else {
          this.summary = res.answer?.plainEnglishSummary ?? res.summary ?? null;
          this.summaryList =
            res.answer?.list?.applies && Array.isArray(res.answer.list.rows) && res.answer.list.rows.length > 0
              ? res.answer.list.rows.map((row) => {
                  if (!row || typeof row !== 'object') return String(row);
                  const rec = row as Record<string, unknown>;
                  const pairs = Object.entries(rec)
                    .slice(0, 4)
                    .map(([k, v]) => `${k}: ${String(v)}`);
                  return pairs.join(', ');
                })
              : (res.summaryList ?? []);
          this.summarySections = res.summarySections ?? [];
          this.results = res.results ?? [];
          this.count = res.count ?? 0;
          this.clarification = false;
        }
        this.refreshTelemetry();
      })
      .catch((e: { error?: { error?: string }; status?: number }) => {
        if (e?.status === 401) {
          this.auth.logout();
          void this.router.navigateByUrl('/login');
          return;
        }
        if (e?.status === 403) {
          this.error = 'Access denied. Only staff or administrators can run AI queries.';
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

  refreshTelemetry(): void {
    this.telemetryError = null;
    this.adminQuery
      .getTelemetry()
      .then((res) => {
        this.telemetry = {
          totals: res.totals,
          intent: res.intent,
          queryType: res.queryType,
        };
      })
      .catch(() => {
        this.telemetryError = 'Telemetry unavailable.';
      });
  }

  copyAnswer(): void {
    if (!this.summary) return;
    navigator.clipboard.writeText(this.summary).then(
      () => {
        this.copied = true;
        setTimeout(() => (this.copied = false), 2000);
      },
      () => {}
    );
  }

  useSuggestion(q: string): void {
    this.question = q;
    this.error = null;
  }

  /** Submit the clarification response: append to question and re-run the query (skip ambiguity check to avoid loop). */
  submitClarification(): void {
    const answer = this.clarificationResponse.trim();
    if (!answer || this.busy) return;
    this.question = `${this.question.trim()} ${answer}`;
    this.clarificationResponse = '';
    this.runQuery({ skipClarification: true });
  }
}
