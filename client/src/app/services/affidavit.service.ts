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

/** Case fields for child-support worksheet UI when `caseId` was sent and the user may see that case. */
export type AffidavitSummaryCaseWorksheet = {
  caseId: string;
  numChildren: number;
  /** Tri-state: null = unset in DB */
  childSupportWorksheetFiled: boolean | null;
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
  /** Full name of the person whose affidavit this is (petitioner when viewing as respondent/attorney). */
  targetUserDisplayName?: string;
  /** Present when summary was requested with `caseId` and the user passes `canSeeCase` for that case. */
  caseWorksheet?: AffidavitSummaryCaseWorksheet | null;
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
