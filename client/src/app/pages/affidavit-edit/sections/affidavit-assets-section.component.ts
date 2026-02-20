import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { AffidavitDataService } from '../../../services/affidavit-data.service';
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
export class AffidavitAssetsSectionComponent implements OnChanges {
  @Input() busy = false;
  @Input() assetsTypes: LookupItem[] = [];
  @Input() nonMaritalTypes: LookupItem[] = [];
  @Input() rows: AssetRow[] = [];
  @Input() userId: string | null = null;

  @Output() create = new EventEmitter<AssetCreatePayload>();
  @Output() remove = new EventEmitter<string>();
  @Output() updateStart = new EventEmitter<void>();
  @Output() updateDone = new EventEmitter<void>();
  @Output() updateFailed = new EventEmitter<string>();

  assetTypeId: number | null = null;
  description = '';
  marketValue = '';
  nonMaritalTypeId: number | null = null;
  judgeAward = false;
  editingId: string | null = null;

  constructor(private readonly api: AffidavitDataService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['assetsTypes'] && this.assetsTypes?.length) {
      this.ensureDefaults();
    }
  }

  ensureDefaults() {
    if (this.assetTypeId == null && this.assetsTypes.length > 0) {
      this.assetTypeId = this.assetsTypes[0]!.id;
    }
  }

  private parseAmount(value: string): number {
    return Number(String(value ?? '').replace(/,/g, ''));
  }

  startEdit(row: AssetRow) {
    this.editingId = row.id;
    this.assetTypeId = row.assetsTypeId ?? this.assetsTypes[0]?.id ?? null;
    this.description = row.description ?? '';
    this.marketValue = String(row.marketValue ?? '');
    this.nonMaritalTypeId = row.nonMaritalTypeId ?? null;
    this.judgeAward = row.judgeAward ?? false;
  }

  cancelEdit() {
    this.editingId = null;
    this.description = '';
    this.marketValue = '';
    this.judgeAward = false;
    this.ensureDefaults();
  }

  doUpdate(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this.editingId) return;
    this.ensureDefaults();
    if (!this.description.trim()) return;
    const mv = this.parseAmount(this.marketValue);
    if (!Number.isFinite(mv) || mv < 0) return;
    const typeId = this.assetTypeId != null ? Number(this.assetTypeId) : NaN;
    if (!Number.isFinite(typeId) || typeId < 1) return;

    this.updateStart.emit();
    this.api
      .patchAsset(
        this.editingId,
        {
          assetsTypeId: typeId,
          description: this.description.trim(),
          marketValue: mv,
          nonMaritalTypeId: this.nonMaritalTypeId != null ? Number(this.nonMaritalTypeId) : null,
          judgeAward: Boolean(this.judgeAward)
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
    this.ensureDefaults();
    if (this.assetTypeId == null || !this.description.trim()) return;

    const mv = this.parseAmount(this.marketValue);
    if (!Number.isFinite(mv) || mv < 0) return;

    const typeId = Number(this.assetTypeId);
    if (!Number.isFinite(typeId) || typeId < 1) return;

    this.create.emit({
      assetsTypeId: typeId,
      description: this.description.trim(),
      marketValue: mv,
      nonMaritalTypeId: this.nonMaritalTypeId != null ? Number(this.nonMaritalTypeId) : undefined,
      judgeAward: Boolean(this.judgeAward)
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
