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

  // Think Energy / similar REPs: "Pay This" + "Amount" on separate lines, then "$7.55".
  const payThis = extractPayThisAmount(lines);
  if (payThis != null) {
    payload.amountDue = payThis;
    fieldConfidences.amountDue = HIGH;
  }

  if (payload.amountDue == null) {
    const dueByLine = findBestAmountByLabel(lines, /\b(total\s+amount\s+due|amount\s+due|total\s+due|balance\s+due)\b/i);
    if (dueByLine != null) {
      payload.amountDue = dueByLine;
      fieldConfidences.amountDue = HIGH;
    }
  }

  if (payload.amountDue == null) {
    const dueIdx = tl.search(
      /total\s+amount\s+due|amount\s+due|total\s+due|balance\s+due|please\s+pay|service\s+period\s+total/
    );
    if (dueIdx >= 0) {
      const amt = firstAmountAfter(t, dueIdx, 900);
      if (amt != null) {
        payload.amountDue = amt;
        fieldConfidences.amountDue = HIGH;
      }
    }
  }

  if (payload.amountDue == null) {
    const periodTotal = findAmountMultilineAfterLabel(
      lines,
      /\b(total\s+charges\s+for\s+this\s+billing\s+period|total\s+current\s+charges)\b/i,
      6
    );
    if (periodTotal != null) {
      payload.amountDue = periodTotal;
      fieldConfidences.amountDue = MED;
    }
  }

  if (payload.amountDue == null) {
    const multilineDue = findAmountMultilineAfterLabel(
      lines,
      /\b(total\s+amount\s+due|amount\s+due)\b/i,
      12
    );
    if (multilineDue != null) {
      payload.amountDue = multilineDue;
      fieldConfidences.amountDue = MED;
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
      const amt = firstAmountAfter(t, dueIdx, 400);
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

  if (/\bthink\s+energy\b/i.test(t)) {
    setUtilityName('Think Energy', 0.75);
  } else if (/\bengie\s+retail\b/i.test(t)) {
    setUtilityName('ENGIE Retail', 0.74);
  }

  const vendor = t.match(/([A-Z][A-Za-z0-9 &\-\.]{2,40})\s*(?:electric|utility|power|energy)/i);
  if (vendor?.[1]) {
    setUtilityName(vendor[1], MED);
  }

  // Common issuer names in bills.
  for (const line of lines) {
    if (/\bcomed\b/i.test(line)) setUtilityName('ComEd', HIGH);
    else if (/\b(oncor|txu|entergy|duke energy|fpl|florida power & light|centerpoint\s+energy)\b/i.test(line))
      setUtilityName(line, MED);
  }

  const period = t.match(/billing\s+period\s*[:\s]+([^\n]{5,80})/i);
  if (period?.[1]) {
    payload.billingPeriodLabel = period[1].trim();
    fieldConfidences.billingPeriodLabel = MED;
  } else {
    const periodNl = t.match(/billing\s+period\s*(?:\n\s*)+([^\n]{8,90})/i);
    if (periodNl?.[1]) {
      payload.billingPeriodLabel = periodNl[1].trim();
      fieldConfidences.billingPeriodLabel = MED;
    } else {
      const serviceFrom = t.match(/service\s+from\s+([^\n]{8,80})/i);
      if (serviceFrom?.[1]) {
        payload.billingPeriodLabel = serviceFrom[1].trim();
        fieldConfidences.billingPeriodLabel = LOW;
      }
    }
  }

  const acct = t.match(/account\s*#?\s*[:\-]?\s*([0-9]{6,})/i);
  if (acct?.[1]) {
    payload.accountNumber = acct[1];
    fieldConfidences.accountNumber = MED;
  }

  if (payload.accountNumber == null) {
    const acctNext = t.match(/account\s*#?\s*[:\-]?\s*\n\s*([0-9]{10,20})\b/im);
    if (acctNext?.[1]) {
      payload.accountNumber = acctNext[1];
      fieldConfidences.accountNumber = LOW;
    }
  }
  if (payload.accountNumber == null) {
    const acctFollow = accountNumberLineAfterKeyword(lines);
    if (acctFollow) {
      payload.accountNumber = acctFollow;
      fieldConfidences.accountNumber = LOW;
    }
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

function extractPayThisAmount(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (!/\bpay\s+this\b/i.test(lines[i]!)) continue;
    for (let j = 1; j <= 10 && i + j < lines.length; j++) {
      const cur = lines[i + j]!.trim();
      if (/\bif\s+paid\s+after\b/i.test(cur)) continue;
      const m = cur.match(/^\$?\s*([\d,]+\.\d{2})\s*$/);
      if (m?.[1]) {
        const n = Number(m[1].replace(/,/g, ''));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return null;
}

/**
 * Amount on a line shortly after a label; skips the "if paid after …" late-payment line + amount.
 */
function findAmountMultilineAfterLabel(lines: string[], label: RegExp, maxJ: number): number | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!label.test(line)) continue;
    if (/\b(payment\s+deducted|thank you|total paid)\b/i.test(line)) continue;
    let skipNextMoney = false;
    for (let j = 1; j <= maxJ && i + j < lines.length; j++) {
      const cur = lines[i + j]!.trim();
      if (/\bif\s+paid\s+after\b/i.test(cur)) {
        skipNextMoney = true;
        continue;
      }
      if (skipNextMoney) {
        skipNextMoney = false;
        continue;
      }
      const m = cur.match(/^\$?\s*([\d,]+\.\d{2})\s*$/);
      if (m?.[1]) {
        const n = Number(m[1].replace(/,/g, ''));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return null;
}

function accountNumberLineAfterKeyword(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!/account\s+number/i.test(lines[i]!)) continue;
    for (let j = 1; j <= 4 && i + j < lines.length; j++) {
      const cand = lines[i + j]!.trim();
      if (/^(payment|due|amount|service|billing)\b/i.test(cand)) continue;
      if (/^\d{10,20}$/.test(cand)) return cand;
    }
  }
  return null;
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
