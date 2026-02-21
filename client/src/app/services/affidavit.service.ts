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

  async summary(userId?: string): Promise<AffidavitSummary> {
    return await firstValueFrom(
      this.http.get<AffidavitSummary>(`${this.apiBase}/affidavit/summary`, {
        params: userId ? { userId } : {}
      })
    );
  }

  async generatePdf(form: 'auto' | 'short' | 'long' = 'auto', userId?: string): Promise<Blob> {
    return await firstValueFrom(
      this.http.get(`${this.apiBase}/affidavit/pdf`, {
        params: { ...(userId ? { userId } : {}), form },
        responseType: 'blob'
      })
    );
  }

  async generateOfficialPdf(
    form: 'auto' | 'short' | 'long' = 'auto',
    userId?: string,
    caseId?: string
  ): Promise<Blob> {
    return await firstValueFrom(
      this.http.get(`${this.apiBase}/affidavit/pdf-template`, {
        params: { ...(userId ? { userId } : {}), ...(caseId ? { caseId } : {}), form },
        responseType: 'blob'
      })
    );
  }
}
