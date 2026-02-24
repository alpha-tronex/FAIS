import { Component, EventEmitter, Input, Output } from '@angular/core';
import { from } from 'rxjs';
import { AffidavitDataService } from '../../../services/affidavit-data.service';
import { ContingentLiabilityRow } from '../../../services/affidavit-data.service';
import { LookupItem } from '../../../services/lookups.service';

export type ContingentLiabilityCreatePayload = {
  description: string;
  possibleAmountOwed: number;
  nonMaritalTypeId?: number | null;
  userOwes?: boolean;
};

@Component({
  standalone: false,
  selector: 'app-affidavit-contingent-liabilities-section',
  templateUrl: './affidavit-contingent-liabilities-section.component.html'
})
export class AffidavitContingentLiabilitiesSectionComponent {
  @Input() busy = false;
  @Input() nonMaritalTypes: LookupItem[] = [];
  @Input() rows: ContingentLiabilityRow[] = [];
  @Input() userId: string | null = null;

  @Output() create = new EventEmitter<ContingentLiabilityCreatePayload>();
  @Output() remove = new EventEmitter<string>();
  @Output() updateStart = new EventEmitter<void>();
  @Output() updateDone = new EventEmitter<void>();
  @Output() updateFailed = new EventEmitter<string>();

  description = '';
  possibleAmountOwed = '';
  nonMaritalTypeId: number | null = null;
  userOwes = true;
  editingId: string | null = null;

  constructor(private readonly api: AffidavitDataService) {}

  private parseAmount(value: string): number {
    return Number(String(value ?? '').replace(/,/g, ''));
  }

  typeLabel(list: LookupItem[], id: number | null): string {
    if (id == null) return '';
    const found = list.find((x) => x.id === id);
    return found?.name ?? '';
  }

  startEdit(row: ContingentLiabilityRow) {
    this.editingId = row.id;
    this.description = row.description ?? '';
    this.possibleAmountOwed = String(row.possibleAmountOwed ?? '');
    this.nonMaritalTypeId = row.nonMaritalTypeId ?? null;
    this.userOwes = row.userOwes ?? true;
  }

  cancelEdit() {
    this.editingId = null;
    this.description = '';
    this.possibleAmountOwed = '';
    this.nonMaritalTypeId = null;
    this.userOwes = true;
  }

  doUpdate(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this.editingId) return;
    if (!this.description.trim()) return;
    const amt = this.parseAmount(this.possibleAmountOwed);
    if (!Number.isFinite(amt) || amt < 0) return;

    this.updateStart.emit();
    from(
      this.api.patchContingentLiability(
        this.editingId,
        {
          description: this.description.trim(),
          possibleAmountOwed: amt,
          nonMaritalTypeId: this.nonMaritalTypeId,
          userOwes: this.userOwes
        },
        this.userId || undefined
      )
    ).subscribe({
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
    if (!this.description.trim()) return;
    const amt = this.parseAmount(this.possibleAmountOwed);
    if (!Number.isFinite(amt) || amt < 0) return;

    this.create.emit({
      description: this.description.trim(),
      possibleAmountOwed: amt,
      nonMaritalTypeId: this.nonMaritalTypeId ?? undefined,
      userOwes: this.userOwes
    });
    this.description = '';
    this.possibleAmountOwed = '';
    this.nonMaritalTypeId = null;
    this.userOwes = true;
  }
}
