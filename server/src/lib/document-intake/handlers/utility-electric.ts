import type { IntakeHandlerResult } from '../types.js';
import { firstAmountAfter } from './shared.js';

const MED = 0.55;
const HIGH = 0.7;
const LOW = 0.38;

export function extractUtilityElectricFromText(text: string): IntakeHandlerResult {
  const t = text.replace(/\r\n/g, '\n');
  const tl = t.toLowerCase();
  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const payload: Record<string, unknown> = {
    targetWorkflow: 'monthlyHouseholdExpense',
    utilityName: null as string | null,
    amountDue: null as number | null,
    billingPeriodLabel: null as string | null,
    accountNumber: null as string | null,
    reviewNotes: [] as string[]
  };
  const fieldConfidences: Record<string, number> = {};

  const dueByLine = findBestAmountByLabel(lines, /\b(total\s+amount\s+due|amount\s+due|total\s+due|balance\s+due)\b/i);
  if (dueByLine != null) {
    payload.amountDue = dueByLine;
    fieldConfidences.amountDue = HIGH;
  } else {
    const dueIdx = tl.search(
      /total\s+amount\s+due|amount\s+due|total\s+due|balance\s+due|please\s+pay|service\s+period\s+total/
    );
    if (dueIdx >= 0) {
      const amt = firstAmountAfter(t, dueIdx, 200);
      if (amt != null) {
        payload.amountDue = amt;
        fieldConfidences.amountDue = HIGH;
      }
    }
  }

  if (payload.amountDue == null) {
    const serviceTotal = findBestAmountByLabel(lines, /\bservice\s+period\s+total\b/i);
    if (serviceTotal != null) {
      payload.amountDue = serviceTotal;
      fieldConfidences.amountDue = MED;
    }
  }

  if (payload.amountDue == null) {
    const dueIdx = tl.search(/please\s+pay|service\s+period\s+total/);
    if (dueIdx >= 0) {
      const amt = firstAmountAfter(t, dueIdx, 200);
      if (amt != null) {
        payload.amountDue = amt;
        fieldConfidences.amountDue = MED;
      }
    }
  }

  const electricIdx = tl.search(/electric|energy\s+charge|kilowatt|kwh|delivery|supply/);
  if (electricIdx >= 0 && payload.amountDue == null) {
    const amt = firstAmountAfter(t, electricIdx, 250);
    if (amt != null) {
      payload.amountDue = amt;
      fieldConfidences.amountDue = MED;
    }
  }

  const setUtilityName = (candidate: string | null, conf: number): void => {
    const normalized = normalizeUtilityName(candidate);
    if (!normalized) return;
    const current = typeof payload.utilityName === 'string' ? payload.utilityName : null;
    const currentConf = fieldConfidences.utilityName ?? 0;
    if (!current || conf >= currentConf) {
      payload.utilityName = normalized;
      fieldConfidences.utilityName = conf;
    }
  };

  const vendor = t.match(/([A-Z][A-Za-z0-9 &\-\.]{2,40})\s*(?:electric|utility|power|energy)/i);
  if (vendor?.[1]) {
    setUtilityName(vendor[1], MED);
  }

  // Common issuer names in bills.
  for (const line of lines) {
    if (/\bcomed\b/i.test(line)) setUtilityName('ComEd', HIGH);
    else if (/\b(oncor|txu|entergy|duke energy|fpl|florida power & light)\b/i.test(line)) setUtilityName(line, MED);
  }

  const period = t.match(/billing\s+period\s*[:\s]+([^\n]{5,80})/i);
  if (period?.[1]) {
    payload.billingPeriodLabel = period[1].trim();
    fieldConfidences.billingPeriodLabel = MED;
  } else {
    const serviceFrom = t.match(/service\s+from\s+([^\n]{8,80})/i);
    if (serviceFrom?.[1]) {
      payload.billingPeriodLabel = serviceFrom[1].trim();
      fieldConfidences.billingPeriodLabel = LOW;
    }
  }

  const acct = t.match(/account\s*#?\s*[:\-]?\s*([0-9]{6,})/i);
  if (acct?.[1]) {
    payload.accountNumber = acct[1];
    fieldConfidences.accountNumber = MED;
  }

  const amountCandidates = collectLabeledAmounts(
    lines,
    /\b(total\s+amount\s+due|amount\s+due|total\s+due|balance\s+due|service\s+period\s+total)\b/i
  );
  if (payload.amountDue != null && hasConflictingAmounts(amountCandidates, payload.amountDue as number)) {
    fieldConfidences.amountDue = Math.max(LOW, (fieldConfidences.amountDue ?? MED) - 0.18);
    (payload.reviewNotes as string[]).push(
      'Conflicting due/total amounts found in the bill text; verify amountDue before applying.'
    );
  }
  if ((payload.reviewNotes as string[]).length === 0) {
    delete payload.reviewNotes;
  }

  return { payload, fieldConfidences };
}

function normalizeUtilityName(input: string | null): string | null {
  if (!input) return null;
  const oneLine = input.replace(/\s+/g, ' ').trim();
  if (!oneLine || oneLine.length < 2 || oneLine.length > 80) return null;
  if (/^(payment|account|charge details|current charges|issued)$/i.test(oneLine)) return null;
  if (/^\d+$/.test(oneLine)) return null;
  return oneLine;
}

function findBestAmountByLabel(lines: string[], label: RegExp): number | null {
  for (const raw of lines) {
    const line = raw.trim();
    if (!label.test(line)) continue;
    // Avoid pulling payment-history / year-to-date values.
    if (/\b(payment\s+deducted|thank you|total paid|year[-\s]*to[-\s]*date|average|last month|last year)\b/i.test(line)) {
      continue;
    }
    const m = line.match(/\$?\s*([\d,]+\.\d{2})\b(?!.*\$?\s*[\d,]+\.\d{2}\b)/);
    if (!m?.[1]) continue;
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function collectLabeledAmounts(lines: string[], label: RegExp): number[] {
  const vals: number[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!label.test(line)) continue;
    if (/\b(payment\s+deducted|thank you|total paid|year[-\s]*to[-\s]*date|average|last month|last year)\b/i.test(line)) {
      continue;
    }
    const all = [...line.matchAll(/\$?\s*([\d,]+\.\d{2})\b/g)].map((m) => m[1]);
    for (const v of all) {
      if (!v) continue;
      const n = Number(v.replace(/,/g, ''));
      if (Number.isFinite(n)) vals.push(n);
    }
  }
  return vals;
}

function hasConflictingAmounts(candidates: number[], selected: number): boolean {
  const rounded = (n: number) => Number(n.toFixed(2));
  const uniq = new Set(candidates.map(rounded));
  if (uniq.size <= 1) return false;
  return !uniq.has(rounded(selected)) || uniq.size > 1;
}
