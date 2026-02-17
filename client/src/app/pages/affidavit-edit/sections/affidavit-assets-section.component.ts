import { Component, EventEmitter, Input, Output } from '@angular/core';
import { LookupItem } from '../../../services/lookups.service';
import { AssetRow } from '../../../services/affidavit-data.service';

export type AssetCreatePayload = {
  assetsTypeId: number;
  description: string;
  marketValue: number;
  nonMaritalTypeId?: number;
  judgeAward?: boolean;
};

@Component({
  standalone: false,
  selector: 'app-affidavit-assets-section',
  templateUrl: './affidavit-assets-section.component.html'
})
export class AffidavitAssetsSectionComponent {
  @Input() busy = false;
  @Input() assetsTypes: LookupItem[] = [];
  @Input() nonMaritalTypes: LookupItem[] = [];
  @Input() rows: AssetRow[] = [];

  @Output() create = new EventEmitter<AssetCreatePayload>();
  @Output() remove = new EventEmitter<string>();

  assetTypeId: number | null = null;
  description = '';
  marketValue = '';
  nonMaritalTypeId: number | null = null;
  judgeAward = false;

  ensureDefaults() {
    if (this.assetTypeId == null && this.assetsTypes.length > 0) {
      this.assetTypeId = this.assetsTypes[0]!.id;
    }
  }

  submit() {
    if (this.assetTypeId == null || !this.description.trim()) return;

    const mv = Number(this.marketValue);
    if (!Number.isFinite(mv) || mv < 0) return;

    this.create.emit({
      assetsTypeId: this.assetTypeId,
      description: this.description.trim(),
      marketValue: mv,
      nonMaritalTypeId: this.nonMaritalTypeId ?? undefined,
      judgeAward: this.judgeAward
    });

    this.description = '';
    this.marketValue = '';
    this.judgeAward = false;
  }

  typeLabel(list: LookupItem[], id: number | null): string {
    if (id == null) return '';
    const found = list.find((x) => x.id === id);
    return found ? found.name : String(id);
  }
}
