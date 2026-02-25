import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type MonthlyIncomeBreakdownRow = {
  typeId: number | null;
  typeName: string;
  amount: number;
  ifOther: string | null;
};

export type AffidavitSummary = {
  legacyUserId?: number;
  grossAnnualIncome: number;
  grossAnnualIncomeFromEmployment: number;
  grossMonthlyIncomeFromMonthlyIncome: number;
  grossAnnualIncomeFromMonthlyIncome: number;
  threshold: number;
  form: 'short' | 'long';
  monthlyIncomeBreakdown?: MonthlyIncomeBreakdownRow[];
};

@Injectable({ providedIn: 'root' })
export class AffidavitService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  async summary(userId?: string, caseId?: string): Promise<AffidavitSummary> {
    const params: Record<string, string> = {};
    if (userId) params['userId'] = userId;
    if (caseId) params['caseId'] = caseId;
    return await firstValueFrom(
      this.http.get<AffidavitSummary>(`${this.apiBase}/affidavit/summary`, { params })
    );
  }

  /**
   * Generate PDF. Server returns official Florida form for admins, HTML summary PDF for others.
   * Respondents (2/4) must pass caseId and only receive HTML PDF.
   */
  async generatePdf(
    form: 'auto' | 'short' | 'long' = 'auto',
    userId?: string,
    caseId?: string
  ): Promise<Blob> {
    const params: Record<string, string> = { form };
    if (userId) params['userId'] = userId;
    if (caseId) params['caseId'] = caseId;
    return await firstValueFrom(
      this.http.get(`${this.apiBase}/affidavit/pdf`, {
        params,
        responseType: 'blob'
      })
    );
  }
}
