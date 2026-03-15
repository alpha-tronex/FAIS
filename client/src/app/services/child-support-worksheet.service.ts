import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type WorksheetData = {
  numberOfChildren?: number;
  childNames?: string[];
  childDatesOfBirth?: string[];
  parentAMonthlyGrossIncome?: number;
  parentBMonthlyGrossIncome?: number;
  overnightsParentA?: number;
  overnightsParentB?: number;
  timesharingPercentageParentA?: number;
  timesharingPercentageParentB?: number;
  healthInsuranceMonthly?: number;
  daycareMonthly?: number;
  otherChildCareMonthly?: number;
  mandatoryUnionDues?: number;
  supportPaidForOtherChildren?: number;
  [key: string]: unknown;
};

export type ChildSupportWorksheetSummary = {
  targetUserDisplayName: string;
  grossAnnualIncome: number;
  grossMonthlyIncomeFromMonthlyIncome: number;
  form: 'short' | 'long';
  worksheet: WorksheetData;
};

@Injectable({ providedIn: 'root' })
export class ChildSupportWorksheetService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  summary(userId?: string, caseId?: string): Promise<ChildSupportWorksheetSummary> {
    const params: Record<string, string> = {};
    if (userId) params['userId'] = userId;
    if (caseId) params['caseId'] = caseId;
    return firstValueFrom(
      this.http.get<ChildSupportWorksheetSummary>(`${this.apiBase}/child-support-worksheet/summary`, { params })
    );
  }

  getWorksheet(userId?: string, caseId?: string): Promise<{ data: WorksheetData }> {
    const params: Record<string, string> = {};
    if (userId) params['userId'] = userId;
    if (caseId) params['caseId'] = caseId;
    return firstValueFrom(
      this.http.get<{ data: WorksheetData }>(`${this.apiBase}/child-support-worksheet`, { params })
    );
  }

  saveWorksheet(data: WorksheetData, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    const params: Record<string, string> = {};
    if (userId) params['userId'] = userId;
    if (caseId) params['caseId'] = caseId;
    return firstValueFrom(
      this.http.put<{ ok: boolean }>(`${this.apiBase}/child-support-worksheet`, { data }, { params })
    );
  }

  generatePdf(userId?: string, caseId?: string): Promise<Blob> {
    const params: Record<string, string> = {};
    if (userId) params['userId'] = userId;
    if (caseId) params['caseId'] = caseId;
    return firstValueFrom(
      this.http.get(`${this.apiBase}/child-support-worksheet/pdf`, {
        params,
        responseType: 'blob'
      })
    );
  }
}
