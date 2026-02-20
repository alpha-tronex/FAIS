import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AffidavitDataService } from '../../../services/affidavit-data.service';
import { LookupItem } from '../../../services/lookups.service';
import { MonthlyLineRow } from '../../../services/affidavit-data.service';

export type MonthlyLineCreatePayload = {
  typeId: number;
  amount: number;
  ifOther?: string;
};

export type MonthlyLineUpdatePayload = {
  id: string;
  typeId: number;
  amount: number;
  ifOther?: string;
};

@Component({
  standalone: false,
  selector: 'app-affidavit-monthly-lines-section',
  templateUrl: './affidavit-monthly-lines-section.component.html'
})
export class AffidavitMonthlyLinesSectionComponent {
  @Input() title = '';
  @Input() busy = false;
  @Input() types: LookupItem[] = [];
  @Input() rows: MonthlyLineRow[] = [];
  /** When set, section performs PATCH itself and emits updateDone/updateFailed. */
  @Input() patchType: 'monthlyIncome' | 'monthlyDeductions' | 'monthlyHouseholdExpenses' | null = null;
  @Input() userId: string | null = null;

  @Output() create = new EventEmitter<MonthlyLineCreatePayload>();
  @Output() update = new EventEmitter<MonthlyLineUpdatePayload>();
  @Output() remove = new EventEmitter<string>();
  @Output() updateStart = new EventEmitter<void>();
  @Output() updateDone = new EventEmitter<void>();
  @Output() updateFailed = new EventEmitter<string>();

  typeId: number | null = null;

  constructor(private readonly api: AffidavitDataService) {}

  amount = '';
  ifOther = '';
  editingId: string | null = null;

  ensureDefaults() {
    if (this.typeId == null && this.types.length > 0) {
      this.typeId = this.types[0]!.id;
    }
  }

  startEdit(row: MonthlyLineRow) {
    this.editingId = row.id;
    this.typeId = row.typeId ?? this.types[0]?.id ?? null;
    this.amount = String(row.amount ?? '');
    this.ifOther = row.ifOther ?? '';
  }

  cancelEdit() {
    this.editingId = null;
    this.amount = '';
    this.ifOther = '';
    this.ensureDefaults();
  }

  /** Parse amount, stripping commas so "3,033.33" works. */
  private parseAmount(value: string): number {
    const cleaned = String(value ?? '').replace(/,/g, '');
    return Number(cleaned);
  }

  /** Called only when Update button is clicked. Runs update path and triggers PATCH. */
  doUpdate(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this.editingId) return;
    this.ensureDefaults();
    const typeIdNum = this.typeId != null ? Number(this.typeId) : NaN;
    if (!Number.isFinite(typeIdNum) || typeIdNum < 1) return;
    const num = this.parseAmount(this.amount);
    if (!Number.isFinite(num) || num < 0) return;

    const body = { typeId: typeIdNum, amount: num, ifOther: this.ifOther.trim() || undefined };
    const id = this.editingId;

    if (this.patchType) {
      this.updateStart.emit();
      const obs =
        this.patchType === 'monthlyIncome'
          ? this.api.patchMonthlyIncome(id, body, this.userId || undefined)
          : this.patchType === 'monthlyDeductions'
            ? this.api.patchMonthlyDeductions(id, body, this.userId || undefined)
            : this.api.patchMonthlyHouseholdExpenses(id, body, this.userId || undefined);
      obs.subscribe({
        next: () => {
          this.updateDone.emit();
          setTimeout(() => this.cancelEdit(), 0);
        },
        error: (e: any) => {
          this.updateFailed.emit(e?.error?.error ?? 'Update failed');
        }
      });
      return;
    }

    const updatePayload: MonthlyLineUpdatePayload = { id, ...body };
    this.update.emit(updatePayload);
    setTimeout(() => this.cancelEdit(), 0);
  }

  submit() {
    if (this.editingId) {
      this.doUpdate();
      return;
    }
    this.ensureDefaults();
    const typeIdNum = this.typeId != null ? Number(this.typeId) : NaN;
    if (!Number.isFinite(typeIdNum) || typeIdNum < 1) return;
    const num = this.parseAmount(this.amount);
    if (!Number.isFinite(num) || num < 0) return;

    this.create.emit({
      typeId: typeIdNum,
      amount: num,
      ifOther: this.ifOther.trim() || undefined
    });
    this.amount = '';
    this.ifOther = '';
  }

  typeLabel(id: number | null): string {
    if (id == null) return '';
    const found = this.types.find((x) => x.id === id);
    return found ? found.name : String(id);
  }
}
