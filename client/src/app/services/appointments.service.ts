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
  durationMinutes?: number;
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
  durationMinutes?: number;
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

  /** List appointments. Optional filters: caseId, date (YYYY-MM-DD), userId (admin only), petitionerId (for availability: petitioner's appointments). */
  async list(options?: { caseId?: string; date?: string; userId?: string; petitionerId?: string }): Promise<AppointmentListItem[]> {
    const params = new URLSearchParams();
    if (options?.caseId) params.set('caseId', options.caseId);
    if (options?.date) params.set('date', options.date);
    if (options?.userId) params.set('userId', options.userId);
    if (options?.petitionerId) params.set('petitionerId', options.petitionerId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return await firstValueFrom(
      this.http.get<AppointmentListItem[]>(`${this.apiBase}/appointments${qs}`)
    );
  }

  async getPendingActionsCount(): Promise<{ count: number }> {
    return await firstValueFrom(
      this.http.get<{ count: number }>(`${this.apiBase}/appointments/pending-actions-count`)
    );
  }

  /**
   * Get the next available slot for the given petitioner and duration (free for both staff and petitioner).
   * Returns null if none in the next 30 days.
   */
  async getNextAvailable(params: {
    petitionerId: string;
    durationMinutes?: number;
    from?: string;
    userId?: string;
  }): Promise<{ date: string; time: string } | null> {
    const search = new URLSearchParams();
    search.set('petitionerId', params.petitionerId);
    if (params.durationMinutes != null) search.set('durationMinutes', String(params.durationMinutes));
    if (params.from) search.set('from', params.from);
    if (params.userId) search.set('userId', params.userId);
    try {
      const res = await firstValueFrom(
        this.http.get<{ date: string; time: string }>(`${this.apiBase}/appointments/next-available?${search.toString()}`)
      );
      return res;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 404) return null;
      throw e;
    }
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
