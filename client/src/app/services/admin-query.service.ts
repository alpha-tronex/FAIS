import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type AdminQueryResponse = {
  /** When present, the question was ambiguous; show this and do not show results. */
  clarification?: string;
  summary: string | null;
  /** When present, render summary as a ul/li list (e.g. counties with income). */
  summaryList?: string[];
  /** When present, render as sections with title + ul/li (e.g. affidavit data grouped by petitioner). */
  summarySections?: { title: string; items: string[] }[];
  count: number;
  results: unknown[];
};

@Injectable({ providedIn: 'root' })
export class AdminQueryService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  query(question: string, options?: { skipClarification?: boolean }): Promise<AdminQueryResponse> {
    return firstValueFrom(
      this.http.post<AdminQueryResponse>(`${this.apiBase}/admin/query`, {
        question: question.trim(),
        skipClarification: options?.skipClarification === true,
      })
    );
  }

  /** Fetch a random set of suggested questions (static + dynamic from ai_query_examples). */
  getSuggestions(count = 5): Promise<{ questions: string[] }> {
    return firstValueFrom(
      this.http.get<{ questions: string[] }>(`${this.apiBase}/admin/ai-query/suggestions`, {
        params: { count: String(count) },
      })
    );
  }
}
