import { Component, EventEmitter, Input, Output } from '@angular/core';
import { from } from 'rxjs';
import { AffidavitDataService } from '../../../services/affidavit-data.service';
import { ContingentAssetRow } from '../../../services/affidavit-data.service';
import { LookupItem } from '../../../services/lookups.service';

export type ContingentAssetCreatePayload = {
  description: string;
  possibleValue: number;
  nonMaritalTypeId?: number | null;
  judgeAward?: boolean;
};

@Component({
  standalone: false,
  selector: 'app-affidavit-contingent-assets-section',
  templateUrl: './affidavit-contingent-assets-section.component.html'
})
export class AffidavitContingentAssetsSectionComponent {
  @Input() busy = false;
  @Input() nonMaritalTypes: LookupItem[] = [];
  @Input() rows: ContingentAssetRow[] = [];
  @Input() userId: string | null = null;

  @Output() create = new EventEmitter<ContingentAssetCreatePayload>();
  @Output() remove = new EventEmitter<string>();
  @Output() updateStart = new EventEmitter<void>();
  @Output() updateDone = new EventEmitter<void>();
  @Output() updateFailed = new EventEmitter<string>();

  description = '';
  possibleValue = '';
  nonMaritalTypeId: number | null = null;
  judgeAward = false;
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

  startEdit(row: ContingentAssetRow) {
    this.editingId = row.id;
    this.description = row.description ?? '';
    this.possibleValue = String(row.possibleValue ?? '');
    this.nonMaritalTypeId = row.nonMaritalTypeId ?? null;
    this.judgeAward = row.judgeAward ?? false;
  }

  cancelEdit() {
    this.editingId = null;
    this.description = '';
    this.possibleValue = '';
    this.nonMaritalTypeId = null;
    this.judgeAward = false;
  }

  doUpdate(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this.editingId) return;
    if (!this.description.trim()) return;
    const val = this.parseAmount(this.possibleValue);
    if (!Number.isFinite(val) || val < 0) return;

    this.updateStart.emit();
    from(
      this.api.patchContingentAsset(
        this.editingId,
        {
          description: this.description.trim(),
          possibleValue: val,
          nonMaritalTypeId: this.nonMaritalTypeId,
          judgeAward: this.judgeAward
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
    const val = this.parseAmount(this.possibleValue);
    if (!Number.isFinite(val) || val < 0) return;

    this.create.emit({
      description: this.description.trim(),
      possibleValue: val,
      nonMaritalTypeId: this.nonMaritalTypeId ?? undefined,
      judgeAward: this.judgeAward
    });
    this.description = '';
    this.possibleValue = '';
    this.nonMaritalTypeId = null;
    this.judgeAward = false;
  }
}
