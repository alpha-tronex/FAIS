import { ChangeDetectorRef, Component, EventEmitter, Input, Output } from '@angular/core';
import { AffidavitDataService } from '../../../services/affidavit-data.service';
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
  @Input() userId: string | null = null;

  @Output() create = new EventEmitter<EmploymentCreatePayload>();
  @Output() remove = new EventEmitter<string>();
  @Output() refresh = new EventEmitter<void>();
  @Output() updateStart = new EventEmitter<void>();
  @Output() updateDone = new EventEmitter<void>();
  @Output() updateFailed = new EventEmitter<string>();

  empName = '';
  empOccupation = '';
  empPayRate = '';
  empPayFrequencyTypeId: number | null = null;
  empPayFrequencyIfOther = '';
  empRetired = false;
  editingId: string | null = null;

  constructor(
    private readonly api: AffidavitDataService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  trackByRowId(_index: number, row: EmploymentRow): string {
    return row?.id ?? '';
  }

  onEditRow(event: Event, row: EmploymentRow): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.editingId === row?.id) return;
    this.startEdit(row);
  }

  private parseAmount(value: string): number {
    return Number(String(value ?? '').replace(/,/g, ''));
  }

  startEdit(row: EmploymentRow): void {
    if (!row?.id) return;
    this.editingId = row.id;
    this.empName = row.name ?? '';
    this.empOccupation = row.occupation ?? '';
    this.empPayRate = String(row.payRate ?? '');
    this.empPayFrequencyTypeId = row.payFrequencyTypeId ?? this.payFrequencies[0]?.id ?? null;
    this.empPayFrequencyIfOther = row.payFrequencyIfOther ?? '';
    this.empRetired = row.retired ?? false;
    this.cdr.detectChanges();
  }

  cancelEdit() {
    this.editingId = null;
    this.empName = '';
    this.empOccupation = '';
    this.empPayRate = '';
    this.empPayFrequencyIfOther = '';
    this.empRetired = false;
    this.ensureDefaults();
  }

  doUpdate(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this.editingId || !this.empName.trim()) return;
    const payRate = this.parseAmount(this.empPayRate);
    if (!Number.isFinite(payRate) || payRate < 0) return;
    const payFrequencyTypeId = Number(this.empPayFrequencyTypeId);
    if (!Number.isFinite(payFrequencyTypeId) || payFrequencyTypeId < 1) return;

    this.updateStart.emit();
    this.api
      .patchEmployment(
        this.editingId,
        {
          name: this.empName.trim(),
          occupation: this.empOccupation.trim() || undefined,
          payRate,
          payFrequencyTypeId,
          payFrequencyIfOther: this.empPayFrequencyIfOther.trim() || undefined,
          retired: this.empRetired
        },
        this.userId || undefined
      )
      .subscribe({
        next: () => {
          this.updateDone.emit();
          setTimeout(() => this.cancelEdit(), 0);
        },
        error: (e: any) => this.updateFailed.emit(e?.error?.error ?? 'Update failed')
      });
  }

  submit() {
    if (this.editingId) {
      this.doUpdate();
      return;
    }
    if (!this.empName.trim() || this.empPayFrequencyTypeId == null) return;
    const payRate = this.parseAmount(this.empPayRate);
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
