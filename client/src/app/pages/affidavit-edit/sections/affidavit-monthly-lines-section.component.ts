import { Component, EventEmitter, Input, Output } from '@angular/core';
import { LookupItem } from '../../../services/lookups.service';
import { MonthlyLineRow } from '../../../services/affidavit-data.service';

export type MonthlyLineCreatePayload = {
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

  @Output() create = new EventEmitter<MonthlyLineCreatePayload>();
  @Output() remove = new EventEmitter<string>();

  typeId: number | null = null;
  amount = '';
  ifOther = '';

  ensureDefaults() {
    if (this.typeId == null && this.types.length > 0) {
      this.typeId = this.types[0]!.id;
    }
  }

  submit() {
    if (this.typeId == null) return;
    const num = Number(this.amount);
    if (!Number.isFinite(num) || num < 0) return;

    this.create.emit({
      typeId: this.typeId,
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
