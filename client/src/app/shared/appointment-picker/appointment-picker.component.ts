import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { APPOINTMENT_TIME_SLOTS, formatTimeSlotDisplay } from './appointment-time-slots';

/**
 * Shared appointment date/time picker. Uses a native date input (Safari-friendly)
 * and a time dropdown from 6:00 AM to 10:00 PM in 15-minute intervals.
 * Value is ISO-like "YYYY-MM-DDTHH:mm" (local date + time).
 */
@Component({
  standalone: false,
  selector: 'app-appointment-picker',
  templateUrl: './appointment-picker.component.html',
  styleUrl: './appointment-picker.component.css',
})
export class AppointmentPickerComponent implements OnChanges {
  readonly timeSlots = APPOINTMENT_TIME_SLOTS;
  readonly formatTime = formatTimeSlotDisplay;

  @Input() value = '';
  @Input() disabled = false;
  @Input() required = false;

  @Output() valueChange = new EventEmitter<string>();

  /** Internal: date part YYYY-MM-DD for <input type="date">. */
  datePart = '';
  /** Internal: time part HH:mm for the select. */
  timePart = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value']) {
      this.syncFromValue(this.value);
    }
  }

  onDateChange(): void {
    if (this.datePart && !this.timePart) {
      this.timePart = APPOINTMENT_TIME_SLOTS[0];
    }
    this.emitValue();
  }

  onTimeChange(): void {
    this.emitValue();
  }

  private syncFromValue(v: string): void {
    if (!v?.trim()) {
      this.datePart = '';
      this.timePart = '';
      return;
    }
    const iso = v.trim();
    const tIdx = iso.indexOf('T');
    if (tIdx !== -1) {
      this.datePart = iso.slice(0, tIdx);
      const timeStr = iso.slice(tIdx + 1);
      const hm = timeStr.slice(0, 5);
      this.timePart = APPOINTMENT_TIME_SLOTS.includes(hm) ? hm : APPOINTMENT_TIME_SLOTS[0];
    } else {
      this.datePart = iso.slice(0, 10);
      this.timePart = APPOINTMENT_TIME_SLOTS[0];
    }
  }

  private emitValue(): void {
    if (this.datePart && this.timePart) {
      this.valueChange.emit(`${this.datePart}T${this.timePart}`);
    } else {
      this.valueChange.emit('');
    }
  }
}
