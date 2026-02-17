import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type AffidavitSummary = {
  legacyUserId: number;
  grossAnnualIncome: number;
  grossAnnualIncomeFromEmployment: number;
  grossMonthlyIncomeFromMonthlyIncome: number;
  grossAnnualIncomeFromMonthlyIncome: number;
  threshold: number;
  form: 'short' | 'long';
};

@Injectable({ providedIn: 'root' })
export class AffidavitService {
  private readonly apiBase = 'http://localhost:3001';

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
}
