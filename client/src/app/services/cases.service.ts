import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type CaseListItem = {
  id: string;
  caseNumber: string;
  division: string;
  petitioner: { id: string; uname: string; firstName?: string; lastName?: string } | null;
  respondent: { id: string; uname: string; firstName?: string; lastName?: string } | null;
  petitionerAttorney: { id: string; uname: string; firstName?: string; lastName?: string } | null;
  respondentAttorney: { id: string; uname: string; firstName?: string; lastName?: string } | null;
  legalAssistant: { id: string; uname: string; firstName?: string; lastName?: string } | null;
  circuitId?: number;
  countyId?: number;
  numChildren?: number;
  childSupportWorksheetFiled?: boolean;
  childSupportWorksheetFiledUpdatedAt?: string | null;
  childSupportWorksheetFiledUpdatedBy?: string | null;
  formTypeId?: number;
  createdAt: string | null;
  /** Set when case is archived. */
  archivedAt?: string | null;
  archivedBy?: string | null;
};

export type CaseDetail = {
  id: string;
  caseNumber: string;
  division: string;
  circuitId?: number;
  countyId?: number;
  numChildren?: number;
  childSupportWorksheetFiled?: boolean;
  childSupportWorksheetFiledUpdatedAt?: string | null;
  childSupportWorksheetFiledUpdatedBy?: string | null;
  formTypeId?: number;
  petitionerId: string | null;
  respondentId: string | null;
  petitionerAttId: string | null;
  respondentAttId: string | null;
  legalAssistantId: string | null;
  archivedAt?: string | null;
  archivedBy?: string | null;
};

export type CreateCaseRequest = {
  caseNumber: string;
  division: string;
  circuitId: number;
  countyId: number;
  numChildren?: number;
  childSupportWorksheetFiled?: boolean;
  petitionerId?: string;
  respondentId?: string;
  petitionerAttId?: string;
  respondentAttId?: string;
  legalAssistantId?: string;
};

export type UpdateCaseRequest = Omit<Partial<CreateCaseRequest>, 'childSupportWorksheetFiled'> & {
  childSupportWorksheetFiled?: boolean | null;
};

@Injectable({ providedIn: 'root' })
export class CasesService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  /** @param archived When true, returns only archived cases (admin only). */
  async list(userId?: string, archived?: boolean): Promise<CaseListItem[]> {
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (archived === true) params.set('archived', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return await firstValueFrom(this.http.get<CaseListItem[]>(`${this.apiBase}/cases${qs}`));
  }

  async create(req: CreateCaseRequest): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/cases`, req));
  }

  async get(caseId: string): Promise<CaseDetail> {
    return await firstValueFrom(this.http.get<CaseDetail>(`${this.apiBase}/cases/${caseId}`));
  }

  async update(caseId: string, req: UpdateCaseRequest): Promise<{ ok: true } | { ok: boolean }> {
    return await firstValueFrom(this.http.patch<{ ok: boolean }>(`${this.apiBase}/cases/${caseId}`, req));
  }

  /** Narrow update for worksheet-filed flag; allowed for staff on the case (not admin-only). */
  async patchChildSupportWorksheetFiled(
    caseId: string,
    childSupportWorksheetFiled: boolean | null
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(`${this.apiBase}/cases/${caseId}/child-support-worksheet-filed`, {
        childSupportWorksheetFiled
      })
    );
  }

  /** Archive case (soft delete). Staff or admin only. */
  async archive(caseId: string): Promise<{ ok: boolean; archivedAt?: string }> {
    return await firstValueFrom(this.http.post<{ ok: boolean; archivedAt?: string }>(`${this.apiBase}/cases/${caseId}/archive`, {}));
  }

  /** Restore archived case. Staff or admin only. */
  async restore(caseId: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.post<{ ok: boolean }>(`${this.apiBase}/cases/${caseId}/restore`, {}));
  }
}
