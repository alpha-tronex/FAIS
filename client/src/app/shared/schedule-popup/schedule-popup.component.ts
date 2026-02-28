import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, combineLatest, finalize, from, map } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AppointmentsService, AppointmentListItem } from '../../services/appointments.service';
import type { CaseListItem } from '../../services/cases.service';
import {
  APPOINTMENT_TIME_SLOTS,
  formatTimeSlotDisplay,
  getContiguousSlots,
  getSlotCountForDuration,
} from '../appointment-picker/appointment-time-slots';

/** Round minutes to nearest 15 (0, 15, 30, 45). Return HH:mm. */
function toSlotHHmm(date: Date): string {
  const m = date.getMinutes();
  const rounded = Math.round(m / 15) * 15;
  const h = rounded === 60 ? date.getHours() + 1 : date.getHours();
  const min = rounded === 60 ? 0 : rounded;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

/** Get local date string YYYY-MM-DD from a Date. */
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

@Component({
  standalone: false,
  selector: 'app-schedule-popup',
  templateUrl: './schedule-popup.component.html',
  styleUrl: './schedule-popup.component.css',
})
export class SchedulePopupComponent implements OnChanges {
  @Input() open = false;
  @Input() cases: CaseListItem[] = [];

  @Output() close = new EventEmitter<void>();
  @Output() created = new EventEmitter<void>();

  caseId = '';
  scheduleWith: 'attorney' | 'legal_assistant' = 'attorney';
  selectedDate = '';
  durationMinutes = 15;
  selectedSlot: string | null = null;
  notes = '';

  readonly durationOptions = [15, 30, 45, 60] as const;

  busySlots: string[] = [];
  busySlotLabels: Record<string, string> = {};
  loadingSlots = false;
  busy = false;
  error: string | null = null;

  nextAvailable: { date: string; time: string } | null = null;
  loadingNextAvailable = false;

  private fetchSub: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly appointmentsApi: AppointmentsService,
    private readonly router: Router
  ) {}

  get isAdmin(): boolean {
    return this.auth.hasRole(5);
  }

  get isAttorney(): boolean {
    return this.auth.hasRole(3);
  }

  get isLegalAssistant(): boolean {
    return this.auth.hasRole(6);
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
    return this.casesForCreate.find((c) => c.id === this.caseId) ?? null;
  }

  /** User id whose calendar we're showing (for admin: the attorney or LA on the selected case). */
  get availabilityUserId(): string | undefined {
    if (this.isAdmin) {
      const c = this.selectedCase;
      if (!c) return undefined;
      return this.scheduleWith === 'attorney' ? c.petitionerAttorney?.id : c.legalAssistant?.id;
    }
    return this.auth.getUserIdFromToken() ?? undefined;
  }

  get scheduledAt(): string {
    if (!this.selectedDate || !this.selectedSlot) return '';
    return `${this.selectedDate}T${this.selectedSlot}`;
  }

  get canLoadSlots(): boolean {
    if (!this.selectedDate) return false;
    if (this.isAdmin && !this.availabilityUserId) return false;
    return true;
  }

  get hasPetitionerForAvailability(): boolean {
    return !!this.selectedCase?.petitioner?.id;
  }

  get canFetchNextAvailable(): boolean {
    if (!this.selectedCase?.petitioner?.id || this.busy) return false;
    if (this.isAdmin && !this.availabilityUserId) return false;
    return true;
  }

  get canCreate(): boolean {
    return !!this.selectedCase && !!this.scheduledAt && !this.busy;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && !this.open) {
      this.reset();
    }
  }

  onClose(): void {
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).hasAttribute('data-schedule-backdrop')) {
      this.onClose();
    }
  }

  loadAvailability(): void {
    if (!this.canLoadSlots) return;
    this.loadingSlots = true;
    this.busySlots = [];
    this.busySlotLabels = {};
    this.fetchSub?.unsubscribe();

    const staffOpts: { date: string; userId?: string } = { date: this.selectedDate };
    if (this.isAdmin && this.availabilityUserId) staffOpts.userId = this.availabilityUserId;

    const petitionerId = this.selectedCase?.petitioner?.id;
    const petitionerOpts =
      petitionerId && this.hasPetitionerForAvailability
        ? { date: this.selectedDate, petitionerId }
        : null;

    const staff$ = from(this.appointmentsApi.list(staffOpts));
    const petitioner$ = petitionerOpts
      ? from(this.appointmentsApi.list(petitionerOpts))
      : from(Promise.resolve<AppointmentListItem[]>([]));

    this.fetchSub = combineLatest([staff$, petitioner$])
      .pipe(
        map(([staffList, petitionerList]) => {
          const byId = new Map<string, AppointmentListItem>();
          for (const a of staffList) byId.set(a.id, a);
          for (const a of petitionerList) if (!byId.has(a.id)) byId.set(a.id, a);
          return [...byId.values()];
        })
      )
      .subscribe({
        next: (list) => {
          this.loadingSlots = false;
          this.deriveBusySlots(list);
        },
        error: () => {
          this.loadingSlots = false;
          this.busySlots = [];
          this.busySlotLabels = {};
        },
      });
  }

  private deriveBusySlots(list: AppointmentListItem[]): void {
    const slotSet = new Set<string>();
    const labels: Record<string, string> = {};
    for (const a of list) {
      if (a.status === 'cancelled' || !a.scheduledAt) continue;
      const d = new Date(a.scheduledAt);
      const localDate = toLocalDateStr(d);
      if (localDate !== this.selectedDate) continue;
      const startSlot = toSlotHHmm(d);
      if (!APPOINTMENT_TIME_SLOTS.includes(startSlot)) continue;
      const duration = a.durationMinutes ?? 15;
      const count = getSlotCountForDuration(duration);
      const label = a.caseNumber ? `Case #${a.caseNumber}` : 'Busy';
      const idx = APPOINTMENT_TIME_SLOTS.indexOf(startSlot);
      for (let i = 0; i < count && idx + i < APPOINTMENT_TIME_SLOTS.length; i++) {
        const slot = APPOINTMENT_TIME_SLOTS[idx + i];
        slotSet.add(slot);
        if (!labels[slot]) labels[slot] = label;
        else labels[slot] = `${labels[slot]}; ${label}`;
      }
    }
    this.busySlots = [...slotSet];
    this.busySlotLabels = labels;
  }

  onSlotSelect(slot: string): void {
    this.selectedSlot = slot;
  }

  fetchNextAvailable(): void {
    if (!this.canFetchNextAvailable) return;
    const petitionerId = this.selectedCase!.petitioner!.id;
    this.loadingNextAvailable = true;
    this.nextAvailable = null;
    const from = new Date();
    const fromStr = `${from.getFullYear()}-${(from.getMonth() + 1).toString().padStart(2, '0')}-${from.getDate().toString().padStart(2, '0')}`;
    const params = {
      petitionerId,
      durationMinutes: this.durationMinutes,
      from: fromStr,
      userId: this.isAdmin ? this.availabilityUserId : undefined,
    };
    this.appointmentsApi
      .getNextAvailable(params)
      .then((result) => {
        this.nextAvailable = result;
      })
      .catch(() => {
        this.nextAvailable = null;
      })
      .finally(() => {
        this.loadingNextAvailable = false;
      });
  }

  useNextAvailable(): void {
    const na = this.nextAvailable;
    if (!na) return;
    this.selectedDate = na.date;
    this.selectedSlot = na.time;
    this.loadAvailability();
  }

  nextAvailableDisplay(): string {
    const na = this.nextAvailable;
    if (!na) return '';
    const d = new Date(`${na.date}T${na.time}`);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  reset(): void {
    this.caseId = '';
    this.scheduleWith = 'attorney';
    this.selectedDate = '';
    this.durationMinutes = 15;
    this.selectedSlot = null;
    this.notes = '';
    this.busySlots = [];
    this.busySlotLabels = {};
    this.nextAvailable = null;
    this.error = null;
    this.fetchSub?.unsubscribe();
    this.fetchSub = null;
  }

  create(): void {
    const c = this.selectedCase;
    if (!c || !this.scheduledAt) return;
    const durationMinutes = this.durationMinutes;
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
          this.error = 'Selected case has no legal assistant.';
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
    this.busy = true;
    this.error = null;
    from(
      this.appointmentsApi.create({
        caseId: c.id,
        petitionerId,
        scheduledAt: this.scheduledAt,
        durationMinutes,
        notes: this.notes?.trim() || undefined,
        ...(petitionerAttId ? { petitionerAttId } : { legalAssistantId: legalAssistantId! }),
      })
    )
      .pipe(finalize(() => { this.busy = false; }))
      .subscribe({
        next: () => {
          this.created.emit();
          this.onClose();
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

  displayName(u: { firstName?: string; lastName?: string; uname: string } | null): string {
    if (!u) return '';
    const name = `${u.lastName ?? ''}, ${u.firstName ?? ''}`.replace(/^,\s*|,\s*$/g, '').trim();
    return name || u.uname;
  }

  selectedTimeDisplay(): string {
    if (!this.selectedDate || !this.selectedSlot) return '';
    const d = new Date(this.scheduledAt);
    const dateStr = d.toLocaleString(undefined, { dateStyle: 'medium' });
    const startStr = formatTimeSlotDisplay(this.selectedSlot);
    if (this.durationMinutes <= 15) return `${dateStr} at ${startStr}`;
    const slots = getContiguousSlots(this.selectedSlot, this.durationMinutes);
    const idx = APPOINTMENT_TIME_SLOTS.indexOf(this.selectedSlot);
    const count = getSlotCountForDuration(this.durationMinutes);
    const endSlotIdx = idx + count;
    const endSlot =
      endSlotIdx < APPOINTMENT_TIME_SLOTS.length ? APPOINTMENT_TIME_SLOTS[endSlotIdx] : slots[slots.length - 1];
    const endStr = formatTimeSlotDisplay(endSlot);
    return `${dateStr}, ${startStr} – ${endStr}`;
  }
}
