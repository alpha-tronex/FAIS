import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type UserSummary = {
  id: string;
  uname: string;
  firstName?: string;
  lastName?: string;
};

export type AppointmentListItem = {
  id: string;
  caseId: string | null;
  caseNumber: string | null;
  petitionerId: string | null;
  petitioner: UserSummary | null;
  petitionerAttId: string | null;
  petitionerAttorney: UserSummary | null;
  legalAssistantId: string | null;
  legalAssistant: UserSummary | null;
  scheduledAt: string | null;
  notes: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'reschedule_requested';
  createdAt: string | null;
};

export type CreateAppointmentRequest = {
  caseId: string;
  petitionerId: string;
  petitionerAttId?: string;
  legalAssistantId?: string;
  scheduledAt: string;
  notes?: string;
};

@Injectable({ providedIn: 'root' })
export class AppointmentsService {
  private readonly apiBase = environment.apiUrl;
  private readonly pendingActionsRefresh$ = new Subject<void>();

  constructor(private readonly http: HttpClient) {}

  /** Emit when the header badge should refetch pending count (e.g. after completing an action on Upcoming Events). */
  getPendingActionsRefresh(): Observable<void> {
    return this.pendingActionsRefresh$.asObservable();
  }

  /** Call after an appointment status change or reschedule so the header badge updates. */
  requestPendingActionsRefresh(): void {
    this.pendingActionsRefresh$.next();
  }

  async list(caseId?: string): Promise<AppointmentListItem[]> {
    const qs = caseId ? `?caseId=${encodeURIComponent(caseId)}` : '';
    return await firstValueFrom(
      this.http.get<AppointmentListItem[]>(`${this.apiBase}/appointments${qs}`)
    );
  }

  async getPendingActionsCount(): Promise<{ count: number }> {
    return await firstValueFrom(
      this.http.get<{ count: number }>(`${this.apiBase}/appointments/pending-actions-count`)
    );
  }

  async create(req: CreateAppointmentRequest): Promise<{ id: string; emailSent: boolean }> {
    return await firstValueFrom(
      this.http.post<{ id: string; emailSent: boolean }>(`${this.apiBase}/appointments`, req)
    );
  }

  async updateStatus(
    appointmentId: string,
    status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'reschedule_requested'
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(`${this.apiBase}/appointments/${appointmentId}`, {
        status,
      })
    );
  }

  async reschedule(
    appointmentId: string,
    payload: { scheduledAt: string; notes?: string; resendInvites?: boolean }
  ): Promise<{ ok: boolean; emailSent?: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean; emailSent?: boolean }>(`${this.apiBase}/appointments/${appointmentId}`, payload)
    );
  }
}
