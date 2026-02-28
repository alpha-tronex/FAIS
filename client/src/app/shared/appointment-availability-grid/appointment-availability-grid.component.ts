import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  APPOINTMENT_TIME_SLOTS,
  formatTimeSlotDisplay,
  getContiguousSlots,
  getSlotCountForDuration,
} from '../appointment-picker/appointment-time-slots';

/**
 * Day grid of appointment slots (6AM–10PM, 15-min). Shows open (clickable) vs busy (disabled).
 * When durationMinutes > 15, a slot is selectable only if that slot and the next contiguous slots are all free.
 * Emits the selected start slot (HH:mm) when user clicks an open slot.
 */
@Component({
  standalone: false,
  selector: 'app-appointment-availability-grid',
  templateUrl: './appointment-availability-grid.component.html',
  styleUrl: './appointment-availability-grid.component.css',
})
export class AppointmentAvailabilityGridComponent {
  readonly timeSlots = APPOINTMENT_TIME_SLOTS;
  readonly formatTime = formatTimeSlotDisplay;

  @Input() date = '';
  @Input() busySlots: string[] = [];
  @Input() selectedSlot: string | null = null;
  @Input() disabled = false;
  /** Duration in minutes (15, 30, 45, 60). A slot is selectable only if this many contiguous minutes are free. */
  @Input() durationMinutes = 15;
  /** Optional label per busy slot for tooltip (e.g. "Case #123") */
  @Input() busySlotLabels: Record<string, string> = {};

  @Output() slotSelect = new EventEmitter<string>();

  isBusy(slot: string): boolean {
    return this.busySlots.includes(slot);
  }

  getBusyLabel(slot: string): string {
    return this.busySlotLabels[slot] ?? 'Busy';
  }

  /** True if this slot is the start of a valid contiguous block of free slots for the current duration. */
  isSelectable(slot: string): boolean {
    if (this.isBusy(slot)) return false;
    const slots = getContiguousSlots(slot, this.durationMinutes);
    if (slots.length < getSlotCountForDuration(this.durationMinutes)) return false;
    return slots.every((s) => !this.isBusy(s));
  }

  /** True if this slot is part of the currently selected range. */
  isInSelectedRange(slot: string): boolean {
    if (!this.selectedSlot) return false;
    const slots = getContiguousSlots(this.selectedSlot, this.durationMinutes);
    return slots.includes(slot);
  }

  onSlotClick(slot: string): void {
    if (this.disabled || !this.isSelectable(slot)) return;
    this.slotSelect.emit(slot);
  }
}
