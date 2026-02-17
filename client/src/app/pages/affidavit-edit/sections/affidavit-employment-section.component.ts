import { Component, EventEmitter, Input, Output } from '@angular/core';
import { LookupItem } from '../../../services/lookups.service';
import { EmploymentRow } from '../../../services/affidavit-data.service';

export type EmploymentCreatePayload = {
  name: string;
  occupation?: string;
  payRate: number;
  payFrequencyTypeId: number;
  payFrequencyIfOther?: string;
  retired?: boolean;
};

@Component({
  standalone: false,
  selector: 'app-affidavit-employment-section',
  templateUrl: './affidavit-employment-section.component.html'
})
export class AffidavitEmploymentSectionComponent {
  @Input() busy = false;
  @Input() payFrequencies: LookupItem[] = [];
  @Input() rows: EmploymentRow[] = [];

  @Output() create = new EventEmitter<EmploymentCreatePayload>();
  @Output() remove = new EventEmitter<string>();
  @Output() refresh = new EventEmitter<void>();

  empName = '';
  empOccupation = '';
  empPayRate = '';
  empPayFrequencyTypeId: number | null = null;
  empPayFrequencyIfOther = '';
  empRetired = false;

  submit() {
    if (!this.empName.trim() || this.empPayFrequencyTypeId == null) return;

    const payRate = Number(this.empPayRate);
    if (!Number.isFinite(payRate) || payRate < 0) return;

    this.create.emit({
      name: this.empName.trim(),
      occupation: this.empOccupation.trim() || undefined,
      payRate,
      payFrequencyTypeId: this.empPayFrequencyTypeId,
      payFrequencyIfOther: this.empPayFrequencyIfOther.trim() || undefined,
      retired: this.empRetired
    });

    this.empName = '';
    this.empOccupation = '';
    this.empPayRate = '';
    this.empPayFrequencyIfOther = '';
    this.empRetired = false;
  }

  typeLabel(id: number | null): string {
    if (id == null) return '';
    const found = this.payFrequencies.find((x) => x.id === id);
    return found ? found.name : String(id);
  }

  ensureDefaults() {
    if (this.empPayFrequencyTypeId == null && this.payFrequencies.length > 0) {
      this.empPayFrequencyTypeId = this.payFrequencies[0]!.id;
    }
  }
}
