import { Component, EventEmitter, Input, Output } from '@angular/core';
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

  @Output() create = new EventEmitter<LiabilityCreatePayload>();
  @Output() remove = new EventEmitter<string>();

  liabilityTypeId: number | null = null;
  description = '';
  amountOwed = '';
  nonMaritalTypeId: number | null = null;
  userOwes = true;

  ensureDefaults() {
    if (this.liabilityTypeId == null && this.liabilitiesTypes.length > 0) {
      this.liabilityTypeId = this.liabilitiesTypes[0]!.id;
    }
  }

  submit() {
    if (this.liabilityTypeId == null || !this.description.trim()) return;

    const owed = Number(this.amountOwed);
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
