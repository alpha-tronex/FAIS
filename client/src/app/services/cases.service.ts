import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type CaseListItem = {
  id: string;
  caseNumber: string;
  division: string;
  petitioner: { id: string; uname: string; firstName?: string; lastName?: string } | null;
  respondent: { id: string; uname: string; firstName?: string; lastName?: string } | null;
  petitionerAttorney: { id: string; uname: string; firstName?: string; lastName?: string } | null;
  respondentAttorney: { id: string; uname: string; firstName?: string; lastName?: string } | null;
  circuitId?: number;
  countyId?: number;
  numChildren?: number;
  formTypeId?: number;
  createdAt: string | null;
};

export type CaseDetail = {
  id: string;
  caseNumber: string;
  division: string;
  circuitId?: number;
  countyId?: number;
  numChildren?: number;
  formTypeId?: number;
  petitionerId: string | null;
  respondentId: string | null;
  petitionerAttId: string | null;
  respondentAttId: string | null;
};

export type CreateCaseRequest = {
  caseNumber: string;
  division: string;
  circuitId: number;
  countyId: number;
  petitionerId?: string;
  respondentId?: string;
  petitionerAttId?: string;
  respondentAttId?: string;
};

@Injectable({ providedIn: 'root' })
export class CasesService {
  private readonly apiBase = 'http://localhost:3001';

  constructor(private readonly http: HttpClient) {}

  async list(userId?: string): Promise<CaseListItem[]> {
    const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    return await firstValueFrom(this.http.get<CaseListItem[]>(`${this.apiBase}/cases${qs}`));
  }

  async create(req: CreateCaseRequest): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/cases`, req));
  }

  async get(caseId: string): Promise<CaseDetail> {
    return await firstValueFrom(this.http.get<CaseDetail>(`${this.apiBase}/cases/${caseId}`));
  }

  async update(caseId: string, req: Partial<CreateCaseRequest>): Promise<{ ok: true } | { ok: boolean }> {
    return await firstValueFrom(this.http.patch<{ ok: boolean }>(`${this.apiBase}/cases/${caseId}`, req));
  }
}
