import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type ReportRow = {
  caseId: string;
  caseNumber: string;
  partyRole: 'respondent' | 'petitioner';
  partyName: string;
  grossAnnualIncome: number;
  under50K: boolean;
  numChildren?: number;
  /** County name for the case. */
  countyName?: string | null;
};

export type ReportResponse = {
  rows: ReportRow[];
  narrative?: string | null;
  /** When present, show this bullet list instead of the table (e.g. "Tell me about respondent x"). */
  aboutUserSummary?: { bullets: string[] } | null;
};

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  queryStructured(prompt: string, userId?: string): Promise<ReportResponse> {
    const url = userId ? `${this.apiBase}/reports/query-structured?userId=${encodeURIComponent(userId)}` : `${this.apiBase}/reports/query-structured`;
    return firstValueFrom(
      this.http.post<ReportResponse>(url, { prompt: prompt.trim() })
    );
  }

  queryNatural(prompt: string, userId?: string): Promise<ReportResponse> {
    const url = userId ? `${this.apiBase}/reports/query-natural?userId=${encodeURIComponent(userId)}` : `${this.apiBase}/reports/query-natural`;
    return firstValueFrom(
      this.http.post<ReportResponse>(url, { prompt: prompt.trim() })
    );
  }
}
