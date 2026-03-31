import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { DocumentIntakeExtraction } from '../../services/documents.service';

/**
 * Full-screen overlay panel for a single document's affidavit intake extraction.
 * Emits actions; parent runs API calls and refreshes data.
 */
@Component({
  standalone: false,
  selector: 'app-document-intake-detail-popup',
  templateUrl: './document-intake-detail-popup.component.html',
  styleUrl: './document-intake-detail-popup.component.css'
})
export class DocumentIntakeDetailPopupComponent {
  @Input() open = false;
  @Input() documentName = '';
  /** When absent, modal shows “not analyzed” empty state. */
  @Input() extraction: DocumentIntakeExtraction | null = null;
  @Input() summaryLine: string | null = null;
  @Input() analyzeBusy = false;
  @Input() rejectBusy = false;
  @Input() applyBusy = false;
  /** Inline success after apply; parent auto-closes the dialog after a delay. */
  @Input() applySuccessMessage: string | null = null;
  /** Inline error when apply fails. */
  @Input() applyErrorMessage: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() reAnalyze = new EventEmitter<void>();
  @Output() reject = new EventEmitter<void>();
  @Output() apply = new EventEmitter<void>();

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).hasAttribute('data-intake-detail-backdrop')) {
      this.closed.emit();
    }
  }

  payloadRows(): { key: string; value: string }[] {
    const raw = this.extraction?.rawPayload;
    if (!raw || typeof raw !== 'object') return [];
    return flatPayloadEntries(raw as Record<string, unknown>);
  }

  confidenceRows(): { key: string; value: string }[] {
    const fc = this.extraction?.fieldConfidences;
    if (!fc || typeof fc !== 'object') return [];
    return Object.keys(fc)
      .sort()
      .map((k) => ({
        key: k,
        value: formatConfidence(fc[k])
      }));
  }

  intakeTypeLabel(docType: string): string {
    switch (docType) {
      case 'w2':
        return 'W-2';
      case 'mortgage_statement':
        return 'Mortgage statement';
      case 'utility_electric':
        return 'Electric utility bill';
      case 'credit_card_mastercard':
        return 'Credit card statement';
      case 'unknown':
        return 'Unknown';
      default:
        return docType;
    }
  }

  applyFlowLabel(docType: string): string {
    switch (docType) {
      case 'w2':
        return 'Apply to employment';
      case 'mortgage_statement':
      case 'credit_card_mastercard':
        return 'Apply to liabilities';
      case 'utility_electric':
        return 'Apply to monthly household expenses';
      default:
        return 'Apply to affidavit';
    }
  }

  get showRejectAndApply(): boolean {
    return this.extraction?.status === 'pending_review';
  }

  /** When true, Apply must stay off until extraction quality and core fields are adequate. */
  get applyDisabled(): boolean {
    const e = this.extraction;
    if (!e || e.status !== 'pending_review') return false;
    if (e.textQuality?.weak) return true;
    if (this.ocrNote) return true;
    return intakeRequiredFieldsMissing(e);
  }

  /** One-line explanation when Apply is disabled (for banner + accessible label). */
  get applyBlockedSummary(): string | null {
    if (!this.extraction || this.extraction.status !== 'pending_review' || !this.applyDisabled) return null;
    const reasons: string[] = [];
    if (this.extraction.textQuality?.weak) reasons.push('text quality is weak');
    if (this.ocrNote) reasons.push('low-quality or scanned text was flagged for this run');
    if (intakeRequiredFieldsMissing(this.extraction)) reasons.push('required extracted fields are missing');
    if (!reasons.length) return 'Apply is unavailable for this extraction.';
    return `Apply is disabled: ${reasons.join('; ')}.`;
  }

  get reanalyzeDisabled(): boolean {
    return this.analyzeBusy || this.extraction?.status === 'processing';
  }

  get applyDisabledOrBusy(): boolean {
    return this.applyDisabled || this.applyBusy;
  }

  get reanalyzeLabel(): string {
    if (this.analyzeBusy) return 'Starting…';
    if (!this.extraction) return 'Analyze for affidavit';
    if (this.extraction.status === 'processing') return 'Analyzing…';
    return 'Re-analyze';
  }

  get ocrNote(): string | null {
    const raw = this.extraction?.rawPayload;
    if (!raw || typeof raw !== 'object') return null;
    const n = (raw as Record<string, unknown>)['ocrNote'];
    return typeof n === 'string' && n.trim().length ? n : null;
  }
}

function formatConfidence(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return (Math.round(v * 100) / 100).toString();
  return String(v ?? '—');
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length ? v : '—';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function flatPayloadEntries(obj: Record<string, unknown>, prefix = ''): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    const v = obj[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      rows.push(...flatPayloadEntries(v as Record<string, unknown>, path));
    } else {
      rows.push({ key: path, value: formatScalar(v) });
    }
  }
  return rows;
}

function nonemptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function finiteNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Core fields expected for each v1 intake type before “apply” is safe.
 * Uses `classifiedType` on the payload when set (matches server), else `documentType`.
 */
function intakeRequiredFieldsMissing(e: DocumentIntakeExtraction): boolean {
  const p = e.rawPayload;
  if (!p || typeof p !== 'object') return true;
  const raw = p as Record<string, unknown>;
  const classified =
    typeof raw['classifiedType'] === 'string' && raw['classifiedType'].length
      ? raw['classifiedType']
      : e.documentType;

  switch (classified) {
    case 'w2':
      return !finiteNumber(raw['box1WagesTipsOther']) || !nonemptyString(raw['employerName']);
    case 'mortgage_statement':
      return !finiteNumber(raw['principalBalance']);
    case 'utility_electric':
      return !finiteNumber(raw['amountDue']) || !nonemptyString(raw['utilityName']);
    case 'credit_card_mastercard':
      return !finiteNumber(raw['statementBalance']);
    case 'unknown':
      return true;
    default:
      return true;
  }
}
