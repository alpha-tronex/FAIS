import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, finalize, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AppointmentsService, AppointmentListItem } from '../../services/appointments.service';
import { CasesService, CaseListItem } from '../../services/cases.service';

@Component({
  standalone: false,
  selector: 'app-upcoming-events-page',
  templateUrl: './upcoming-events.page.html',
  styleUrl: './upcoming-events.page.css',
})
export class UpcomingEventsPage implements OnInit, OnDestroy {
  appointments: AppointmentListItem[] = [];
  cases: CaseListItem[] = [];

  caseId = '';
  /** For admin: schedule with petitioner attorney or legal assistant. */
  scheduleWith: 'attorney' | 'legal_assistant' = 'attorney';
  scheduledAt = '';
  notes = '';

  busy = false;
  error: string | null = null;
  success: string | null = null;

  reschedulePromptOpen = false;
  reschedulePromptAppointment: AppointmentListItem | null = null;
  reschedulePromptIfNo: 'rejected' | 'cancelled' = 'rejected';

  editingRescheduleAppointment: AppointmentListItem | null = null;
  rescheduleScheduledAt = '';
  rescheduleNotes = '';

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly appointmentsApi: AppointmentsService,
    private readonly casesApi: CasesService,
    private readonly router: Router
  ) {}

  get isPetitioner(): boolean {
    return this.auth.hasRole(1);
  }

  get isAttorney(): boolean {
    return this.auth.hasRole(3);
  }

  get isLegalAssistant(): boolean {
    return this.auth.hasRole(6);
  }

  get isAdmin(): boolean {
    return this.auth.hasRole(5);
  }

  get canCreate(): boolean {
    return this.isAttorney || this.isLegalAssistant || this.isAdmin;
  }

  get casesForCreate(): CaseListItem[] {
    if (this.isAdmin) return this.cases;
    const myUserId = this.auth.getUserIdFromToken();
    if (this.isAttorney && myUserId) {
      return this.cases.filter((c) => c.petitionerAttorney?.id === myUserId);
    }
    if (this.isLegalAssistant && myUserId) {
      return this.cases.filter((c) => c.legalAssistant?.id === myUserId);
    }
    return this.cases;
  }

  get selectedCase(): CaseListItem | null {
    if (!this.caseId) return null;
    return this.cases.find((c) => c.id === this.caseId) ?? null;
  }

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/login');
      return;
    }
    if (!this.auth.hasRole(1, 3, 5, 6)) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }
    this.refresh();
    if (this.canCreate) {
      this.loadCases();
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private loadCases(): void {
    from(this.casesApi.list())
      .subscribe({
        next: (cases) => {
          this.cases = cases;
        },
        error: () => {
          // Non-blocking; create form may still show
        },
      });
  }

  refresh(): void {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.success = null;

    const caseIdFilter = this.isAdmin && this.caseId ? this.caseId : undefined;
    this.subscription = from(this.appointmentsApi.list(caseIdFilter))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (list) => {
          this.appointments = list;
        },
        error: (e: unknown) => {
          const err = e as { error?: { error?: string }; status?: number };
          this.error = err?.error?.error ?? 'Failed to load appointments';
          if (err?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        },
      });
  }

  displayName(u: { firstName?: string; lastName?: string; uname: string } | null): string {
    if (!u) return '';
    const name = `${u.lastName ?? ''}, ${u.firstName ?? ''}`.replace(/^,\s*|,\s*$/g, '').trim();
    return name || u.uname;
  }

  /** Counterparty for display: attorney or legal assistant. */
  counterpartyName(a: AppointmentListItem): string {
    const u = a.petitionerAttorney ?? a.legalAssistant;
    return this.displayName(u);
  }

  create(): void {
    if (!this.canCreate || !this.selectedCase) return;
    const c = this.selectedCase;
    const petitionerId = c.petitioner?.id;
    if (!petitionerId) {
      this.error = 'Selected case must have a petitioner.';
      return;
    }
    let petitionerAttId: string | undefined;
    let legalAssistantId: string | undefined;
    if (this.isAdmin) {
      if (this.scheduleWith === 'attorney') {
        petitionerAttId = c.petitionerAttorney?.id;
        if (!petitionerAttId) {
          this.error = 'Selected case has no petitioner attorney.';
          return;
        }
      } else {
        legalAssistantId = c.legalAssistant?.id;
        if (!legalAssistantId) {
          this.error = 'Selected case has no legal assistant. Choose Petitioner Attorney or add a legal assistant to the case.';
          return;
        }
      }
    } else if (this.isAttorney) {
      petitionerAttId = c.petitionerAttorney?.id;
      if (!petitionerAttId) {
        this.error = 'Selected case must have a petitioner attorney.';
        return;
        }
    } else if (this.isLegalAssistant) {
      legalAssistantId = c.legalAssistant?.id;
      if (!legalAssistantId) {
        this.error = 'You are not the legal assistant on this case.';
        return;
      }
    }
    const scheduledAt = this.scheduledAt?.trim();
    if (!scheduledAt) {
      this.error = 'Please select date and time.';
      return;
    }
    this.busy = true;
    this.error = null;
    this.success = null;

    const payload = {
      caseId: c.id,
      petitionerId,
      scheduledAt,
      notes: this.notes?.trim() || undefined,
      ...(petitionerAttId ? { petitionerAttId } : { legalAssistantId: legalAssistantId! }),
    };

    from(this.appointmentsApi.create(payload))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (res) => {
          this.success = res.emailSent
            ? 'Appointment set and invitation emails have been sent.'
            : 'Appointment set; one or more invitation emails could not be sent.';
          this.scheduledAt = '';
          this.notes = '';
          this.refresh();
        },
        error: (e: unknown) => {
          const err = e as { error?: { error?: string }; status?: number };
          this.error = err?.error?.error ?? 'Failed to create appointment';
          if (err?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        },
      });
  }

  openReschedulePrompt(appointment: AppointmentListItem, ifNo: 'rejected' | 'cancelled'): void {
    this.reschedulePromptAppointment = appointment;
    this.reschedulePromptIfNo = ifNo;
    this.reschedulePromptOpen = true;
  }

  onReschedulePromptConfirm(): void {
    const a = this.reschedulePromptAppointment;
    this.reschedulePromptOpen = false;
    this.reschedulePromptAppointment = null;
    if (!a) return;
    this.setStatus(a, 'reschedule_requested');
  }

  onReschedulePromptCancel(): void {
    const a = this.reschedulePromptAppointment;
    const ifNo = this.reschedulePromptIfNo;
    this.reschedulePromptOpen = false;
    this.reschedulePromptAppointment = null;
    if (!a) return;
    this.setStatus(a, ifNo);
  }

  setStatus(appointment: AppointmentListItem, status: 'accepted' | 'rejected' | 'cancelled' | 'reschedule_requested'): void {
    if (!this.isPetitioner && status !== 'reschedule_requested') return;
    if (this.isPetitioner) {
      if (status === 'cancelled') {
        if (appointment.status !== 'accepted') return;
      } else if (status === 'reschedule_requested') {
        if (appointment.status !== 'pending' && appointment.status !== 'accepted') return;
      } else {
        if (appointment.status !== 'pending') return;
      }
    }
    this.busy = true;
    this.error = null;
    this.success = null;

    from(this.appointmentsApi.updateStatus(appointment.id, status))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => {
          const msg =
            status === 'accepted'
              ? 'You have accepted the appointment. The attorney will see the updated status.'
              : status === 'rejected'
                ? 'You have rejected the appointment. The attorney will see the updated status.'
                : status === 'cancelled'
                  ? 'You have cancelled the appointment. The attorney will see the updated status.'
                  : 'You have requested to reschedule. The attorney or admin can propose a new time.';
          this.success = msg;
          this.refresh();
        },
        error: (e: unknown) => {
          const err = e as { error?: { error?: string }; status?: number };
          this.error = err?.error?.error ?? 'Failed to update appointment';
          if (err?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        },
      });
  }

  canReschedule(a: AppointmentListItem): boolean {
    if (a.status !== 'reschedule_requested') return false;
    if (this.isAdmin) return true;
    const myUserId = this.auth.getUserIdFromToken();
    if (!myUserId) return false;
    return (this.isAttorney && a.petitionerAttId === myUserId) || (this.isLegalAssistant && a.legalAssistantId === myUserId);
  }

  openRescheduleForm(a: AppointmentListItem): void {
    this.editingRescheduleAppointment = a;
    this.rescheduleScheduledAt = a.scheduledAt ? new Date(a.scheduledAt).toISOString().slice(0, 16) : '';
    this.rescheduleNotes = a.notes ?? '';
  }

  cancelRescheduleForm(): void {
    this.editingRescheduleAppointment = null;
    this.rescheduleScheduledAt = '';
    this.rescheduleNotes = '';
  }

  submitReschedule(): void {
    const a = this.editingRescheduleAppointment;
    if (!a || !this.rescheduleScheduledAt?.trim()) return;
    this.busy = true;
    this.error = null;
    this.success = null;
    from(
      this.appointmentsApi.reschedule(a.id, {
        scheduledAt: this.rescheduleScheduledAt.trim(),
        notes: this.rescheduleNotes?.trim() || undefined,
        resendInvites: true,
      })
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (res) => {
          this.success = res.emailSent
            ? 'Appointment rescheduled and invitations sent.'
            : 'Appointment rescheduled.';
          this.cancelRescheduleForm();
          this.refresh();
        },
        error: (e: unknown) => {
          const err = e as { error?: { error?: string }; status?: number };
          this.error = err?.error?.error ?? 'Failed to reschedule appointment';
          if (err?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        },
      });
  }

  cancelByAttorneyOrAdmin(appointment: AppointmentListItem): void {
    if ((!this.isAttorney && !this.isLegalAssistant && !this.isAdmin) || appointment.status === 'cancelled') return;
    this.busy = true;
    this.error = null;
    this.success = null;

    from(this.appointmentsApi.updateStatus(appointment.id, 'cancelled'))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => {
          this.success = 'Appointment cancelled.';
          this.refresh();
        },
        error: (e: unknown) => {
          const err = e as { error?: { error?: string }; status?: number };
          this.error = err?.error?.error ?? 'Failed to cancel appointment';
          if (err?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        },
      });
  }
}
