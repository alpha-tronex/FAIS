import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AffidavitDataService } from '../../../services/affidavit-data.service';
import { LookupItem } from '../../../services/lookups.service';
import { LiabilityRow } from '../../../services/affidavit-data.service';

export type LiabilityCreatePayload = {
  liabilitiesTypeId: number;
  description: string;
  amountOwed: number;
  nonMaritalTypeId?: number;
  userOwes?: boolean;
};

@Component({
  standalone: false,
  selector: 'app-affidavit-liabilities-section',
  templateUrl: './affidavit-liabilities-section.component.html'
})
export class AffidavitLiabilitiesSectionComponent {
  @Input() busy = false;
  @Input() liabilitiesTypes: LookupItem[] = [];
  @Input() nonMaritalTypes: LookupItem[] = [];
  @Input() rows: LiabilityRow[] = [];
  @Input() userId: string | null = null;

  @Output() create = new EventEmitter<LiabilityCreatePayload>();
  @Output() remove = new EventEmitter<string>();
  @Output() updateStart = new EventEmitter<void>();
  @Output() updateDone = new EventEmitter<void>();
  @Output() updateFailed = new EventEmitter<string>();

  liabilityTypeId: number | null = null;
  description = '';
  amountOwed = '';
  nonMaritalTypeId: number | null = null;
  userOwes = true;
  editingId: string | null = null;

  constructor(private readonly api: AffidavitDataService) {}

  ensureDefaults() {
    if (this.liabilityTypeId == null && this.liabilitiesTypes.length > 0) {
      this.liabilityTypeId = this.liabilitiesTypes[0]!.id;
    }
  }

  private parseAmount(value: string): number {
    return Number(String(value ?? '').replace(/,/g, ''));
  }

  startEdit(row: LiabilityRow) {
    this.editingId = row.id;
    this.liabilityTypeId = row.liabilitiesTypeId ?? this.liabilitiesTypes[0]?.id ?? null;
    this.description = row.description ?? '';
    this.amountOwed = String(row.amountOwed ?? '');
    this.nonMaritalTypeId = row.nonMaritalTypeId ?? null;
    this.userOwes = row.userOwes ?? true;
  }

  cancelEdit() {
    this.editingId = null;
    this.description = '';
    this.amountOwed = '';
    this.userOwes = true;
    this.ensureDefaults();
  }

  doUpdate(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this.editingId || !this.description.trim()) return;
    const owed = this.parseAmount(this.amountOwed);
    if (!Number.isFinite(owed) || owed < 0) return;
    const liabilitiesTypeId = this.liabilityTypeId != null ? Number(this.liabilityTypeId) : NaN;
    if (!Number.isFinite(liabilitiesTypeId) || liabilitiesTypeId < 1) return;

    this.updateStart.emit();
    this.api
      .patchLiability(
        this.editingId,
        {
          liabilitiesTypeId,
          description: this.description.trim(),
          amountOwed: owed,
          nonMaritalTypeId: this.nonMaritalTypeId != null ? Number(this.nonMaritalTypeId) : null,
          userOwes: Boolean(this.userOwes)
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
    if (this.liabilityTypeId == null || !this.description.trim()) return;

    const owed = this.parseAmount(this.amountOwed);
    if (!Number.isFinite(owed) || owed < 0) return;

    this.create.emit({
      liabilitiesTypeId: this.liabilityTypeId,
      description: this.description.trim(),
      amountOwed: owed,
      nonMaritalTypeId: this.nonMaritalTypeId ?? undefined,
      userOwes: this.userOwes
    });

    this.description = '';
    this.amountOwed = '';
    this.userOwes = true;
  }

  typeLabel(list: LookupItem[], id: number | null): string {
    if (id == null) return '';
    const found = list.find((x) => x.id === id);
    return found ? found.name : String(id);
  }
}
