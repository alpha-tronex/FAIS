import type { IntakeHandlerResult } from '../types.js';
import { firstAmountAfter } from './shared.js';

const MED = 0.55;
const HIGH = 0.72;
const LOW = 0.38;

export function extractCreditCardMastercardFromText(text: string): IntakeHandlerResult {
  const t = text.replace(/\r\n/g, '\n');
  const tl = t.toLowerCase();
  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const payload: Record<string, unknown> = {
    targetWorkflow: 'liabilities',
    creditorName: null as string | null,
    statementBalance: null as number | null,
    minimumPayment: null as number | null,
    statementClosingDate: null as string | null,
    dueDate: null as string | null,
    accountLast4: null as string | null,
    reviewNotes: [] as string[]
  };
  const fieldConfidences: Record<string, number> = {};

  const newBalByLine = findLabeledCardAmount(lines, /\bnew\s+balance\b/i);
  if (newBalByLine != null) {
    payload.statementBalance = newBalByLine;
    fieldConfidences.statementBalance = HIGH;
  } else {
    const newBalIdx = tl.search(/new\s+balance/);
    if (newBalIdx >= 0) {
      const amt = firstAmountAfter(t, newBalIdx, 160);
      if (amt != null) {
        payload.statementBalance = amt;
        fieldConfidences.statementBalance = HIGH;
      }
    }
  }

  if (payload.statementBalance == null) {
    const stmtIdx = tl.search(/statement\s+balance|current\s+balance|outstanding\s+balance/);
    if (stmtIdx >= 0) {
      const amt = firstAmountAfter(t, stmtIdx, 180);
      if (amt != null) {
        payload.statementBalance = amt;
        fieldConfidences.statementBalance = MED;
      }
    }
  }

  // Some statements put the balance on the same line as a label.
  if (payload.statementBalance == null) {
    const currentByLine = findLabeledCardAmount(lines, /\bcurrent\s+balance\b/i);
    if (currentByLine != null) {
      payload.statementBalance = currentByLine;
      fieldConfidences.statementBalance = HIGH;
    }
  }

  // Some non-US statements use "available on" / "account balance" with spaces as thousand separators.
  if (payload.statementBalance == null) {
    const byLine = findLabeledFlexibleAmount(
      lines,
      /\b(available\s+on|well\s+on|account\s+balance|balance\s+on)\b/i
    );
    if (byLine != null) {
      payload.statementBalance = byLine;
      fieldConfidences.statementBalance = MED;
    }
  }

  const minByLine = findLabeledCardAmount(lines, /\bminimum\s+payment\b/i);
  if (minByLine != null) {
    payload.minimumPayment = minByLine;
    fieldConfidences.minimumPayment = MED;
  } else {
    const minIdx = tl.search(/minimum\s+payment/);
    if (minIdx >= 0) {
      const amt = firstAmountAfter(t, minIdx, 140);
      if (amt != null) {
        payload.minimumPayment = amt;
        fieldConfidences.minimumPayment = MED;
      }
    }
  }

  // Table-style line often has "$NEW_BALANCE $MIN_PAYMENT DUE_DATE".
  const tableAmounts = t.match(
    /new\s+balance\s+minimum\s+payment\s+due\s+date[\s\S]{0,140}?\$?\s*([\d,]+\.\d{2})\s+\$?\s*([\d,]+\.\d{2})(?:\s+([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4}))?/i
  );
  if (tableAmounts?.[1] && tableAmounts?.[2]) {
    const newBalance = Number(tableAmounts[1].replace(/,/g, ''));
    const minPayment = Number(tableAmounts[2].replace(/,/g, ''));
    if (Number.isFinite(newBalance) && payload.statementBalance == null) {
      payload.statementBalance = newBalance;
      fieldConfidences.statementBalance = HIGH;
    }
    if (Number.isFinite(minPayment)) {
      payload.minimumPayment = minPayment;
      fieldConfidences.minimumPayment = HIGH;
    }
    if (tableAmounts[3]) {
      payload.dueDate = tableAmounts[3].replace(/\s+/g, ' ').trim();
      fieldConfidences.dueDate = HIGH;
    }
  }

  const setCreditor = (candidate: string | null, conf: number): void => {
    const normalized = normalizeCreditorName(candidate);
    if (!normalized) return;
    const current = typeof payload.creditorName === 'string' ? payload.creditorName : null;
    const currentConf = fieldConfidences.creditorName ?? 0;
    if (!current || conf >= currentConf) {
      payload.creditorName = normalized;
      fieldConfidences.creditorName = conf;
    }
  };

  const creditor = t.match(/^([A-Z][A-Za-z0-9\s&\-\.]{2,45})\s*[\n\r]/m);
  if (creditor?.[1]) {
    setCreditor(creditor[1], LOW);
  }

  for (const line of lines) {
    if (/\bcapital one\b/i.test(line)) setCreditor('Capital One', HIGH);
    else if (/\bcitibank|\bciti\b/i.test(line)) setCreditor('Citibank', HIGH);
    else if (/\bmastercard\b/i.test(line)) setCreditor(line, MED);
  }

  const closing = t.match(/closing\s*date[^\n\d]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (closing?.[1]) {
    payload.statementClosingDate = closing[1];
    fieldConfidences.statementClosingDate = LOW;
  } else {
    const cycleRange = t.match(/\b([A-Z][a-z]{2}\.?\s*\d{1,2})\s*-\s*([A-Z][a-z]{2}\.?\s*\d{1,2}),\s*(\d{4})/);
    if (cycleRange?.[2] && cycleRange[3]) {
      payload.statementClosingDate = `${cycleRange[2]}, ${cycleRange[3]}`;
      fieldConfidences.statementClosingDate = MED;
    }
  }

  // Due date: capture full month name (avoid consuming it before the capture).
  const due =
    t.match(
      /\b(?:payment\s+)?due\s+date\s*[:#]?\s*([A-Z][a-z]{2,12}\s+\d{1,2},\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
    ) ??
    t.match(
      /\b(?:payment\s+)?due\s+date\b[^\n]*\n\s*([A-Z][a-z]{2,12}\s+\d{1,2},\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
    );
  if (due?.[1]) {
    payload.dueDate = due[1].replace(/\s+/g, ' ').trim();
    fieldConfidences.dueDate = HIGH;
  }

  const acct4 =
    t.match(/(?:\*{2,}|•{2,})\s*(\d{4})\b/) ??
    t.match(/\b\d{4}\s+\d{2}\*{2}\s+\*{4}\s+(\d{4})\b/) ??
    t.match(/account\s+ending\s+in\s+(\d{4})/i) ??
    t.match(/account\s*(?:no\.?|number)?\s*[:#]?\s*(?:\*+)?(\d{4})\b/i);
  if (acct4?.[1]) {
    payload.accountLast4 = acct4[1];
    fieldConfidences.accountLast4 = MED;
  }
  if (!payload.accountLast4) {
    // E.g. "4147465002040807" or "4147 4650 0204 0807"
    const unmasked =
      t.match(/\b\d{12}(\d{4})\b/) ??
      t.match(/\b\d{4}\s+\d{4}\s+\d{4}\s+(\d{4})\b/);
    if (unmasked?.[1]) {
      payload.accountLast4 = unmasked[1];
      fieldConfidences.accountLast4 = LOW;
    }
  }

  const statementCandidates = collectCardAmounts(lines, /\b(new\s+balance|statement\s+balance|current\s+balance|outstanding\s+balance)\b/i);
  const minimumCandidates = collectCardAmounts(lines, /\bminimum\s+payment\b/i);
  if (payload.statementBalance != null && hasConflictingAmounts(statementCandidates, payload.statementBalance as number)) {
    fieldConfidences.statementBalance = Math.max(LOW, (fieldConfidences.statementBalance ?? MED) - 0.2);
    (payload.reviewNotes as string[]).push(
      'Multiple statement-balance values were detected; verify statementBalance before applying.'
    );
  }
  if (payload.minimumPayment != null && hasConflictingAmounts(minimumCandidates, payload.minimumPayment as number)) {
    fieldConfidences.minimumPayment = Math.max(LOW, (fieldConfidences.minimumPayment ?? MED) - 0.18);
    (payload.reviewNotes as string[]).push(
      'Multiple minimum-payment values were detected; verify minimumPayment before applying.'
    );
  }
  if ((payload.reviewNotes as string[]).length === 0) {
    delete payload.reviewNotes;
  }

  return { payload, fieldConfidences };
}

function normalizeCreditorName(input: string | null): string | null {
  if (!input) return null;
  const oneLine = input.replace(/\s+/g, ' ').trim();
  if (!oneLine || oneLine.length < 2 || oneLine.length > 80) return null;
  if (/^(transactions|statement|account|page|please return|new balance)/i.test(oneLine)) return null;
  if (/^\d+$/.test(oneLine)) return null;
  return oneLine;
}

function findLabeledCardAmount(lines: string[], label: RegExp): number | null {
  for (const raw of lines) {
    const line = raw.trim();
    if (!label.test(line)) continue;
    // Ignore warning examples and educational text blocks.
    if (/\b(warning|example|estimated|years|total cost|if you make only)\b/i.test(line)) continue;
    const all = [...line.matchAll(/\$?\s*([\d,]+\.\d{2})\b/g)].map((m) => m[1]);
    if (all.length === 0) continue;
    const pick = all[all.length - 1];
    if (!pick) continue;
    const n = Number(pick.replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function findLabeledFlexibleAmount(lines: string[], label: RegExp): number | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!label.test(line)) continue;
    // Some PDFs split "Available on <date>" and "<amount>" across lines.
    const window = [line, lines[i + 1] ?? '', lines[i + 2] ?? ''].join(' ');
    const n = lastFlexibleMoneyFromText(window);
    if (n != null) return n;
  }
  return null;
}

function lastFlexibleMoneyFromText(text: string): number | null {
  // Supports "84 072.12", "1,043.00", "744.53" and avoids date fragments like "14.06.2020".
  const re = /(?:\d{1,3}(?:[ ,]\d{3})+|\d{1,6})\.\d{2}/g;
  const matches: Array<{ value: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0] ?? '';
    if (!raw) continue;
    const end = m.index + raw.length;
    // Skip date fragment where amount-like token is immediately followed by ".YYYY".
    if (text[end] === '.') continue;
    const n = Number(raw.replace(/[ ,]/g, ''));
    if (Number.isFinite(n)) matches.push({ value: n, end });
  }
  if (matches.length === 0) return null;
  return matches[matches.length - 1]!.value;
}

function collectCardAmounts(lines: string[], label: RegExp): number[] {
  const vals: number[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!label.test(line)) continue;
    if (/\b(warning|example|estimated|years|total cost|if you make only)\b/i.test(line)) continue;
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
