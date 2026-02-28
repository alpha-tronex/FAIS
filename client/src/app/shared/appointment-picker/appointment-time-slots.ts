/**
 * Appointment time slots: 6:00 AM to 10:00 PM in 15-minute intervals.
 * Values are 24h "HH:mm" for use with date + time.
 */
export const APPOINTMENT_TIME_SLOTS: readonly string[] = (() => {
  const slots: string[] = [];
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 22 && m > 0) break;
      slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    }
  }
  return slots;
})();

/** Number of 15-min slots for a given duration in minutes. */
export function getSlotCountForDuration(durationMinutes: number): number {
  return Math.max(1, Math.min(4, Math.round(durationMinutes / 15)));
}

/** Return contiguous slot strings from startSlot (HH:mm) for the given duration. */
export function getContiguousSlots(startSlot: string, durationMinutes: number): string[] {
  const idx = APPOINTMENT_TIME_SLOTS.indexOf(startSlot);
  if (idx === -1) return [];
  const count = getSlotCountForDuration(durationMinutes);
  const out: string[] = [];
  for (let i = 0; i < count && idx + i < APPOINTMENT_TIME_SLOTS.length; i++) {
    out.push(APPOINTMENT_TIME_SLOTS[idx + i]);
  }
  return out;
}

/** Format "HH:mm" as 12h display, e.g. "06:00" -> "6:00 AM", "14:30" -> "2:30 PM". */
export function formatTimeSlotDisplay(value: string): string {
  const [hStr, mStr] = value.split(':');
  const h = parseInt(hStr ?? '0', 10);
  const m = mStr ?? '00';
  if (h === 0) return `12:${m} AM`;
  if (h < 12) return `${h}:${m} AM`;
  if (h === 12) return `12:${m} PM`;
  return `${h - 12}:${m} PM`;
}
