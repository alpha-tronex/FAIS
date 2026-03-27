import type { IntakeHandlerResult } from '../types.js';
import { firstAmountAfter, parseMoneyString } from './shared.js';

const MED = 0.55;
const HIGH = 0.68;
const LOW_CONF = 0.4;
const HIGH_NAME = 0.7;
/** Stronger than `HIGH_NAME` so full legal servicer lines beat logo-only headers. */
const STRONG_NAME = 0.75;

export function extractMortgageFromText(text: string): IntakeHandlerResult {
  const t = text.replace(/\r\n/g, '\n');
  const tl = t.toLowerCase();
  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const payload: Record<string, unknown> = {
    targetWorkflow: 'liabilities',
    lenderName: null as string | null,
    principalBalance: null as number | null,
    monthlyPayment: null as number | null,
    statementDate: null as string | null,
    dueDate: null as string | null,
    loanNumber: null as string | null
  };
  const fieldConfidences: Record<string, number> = {};

  // Principal on many statements is labeled "Outstanding Principal" (not always "principal balance").
  const principalIdx = tl.search(
    /unpaid\s+principal|principal\s+balance|loan\s+balance|outstanding\s+balance|outstanding\s+principal/
  );
  if (principalIdx >= 0) {
    // Some statements place the principal number far from the label (and may include other balances earlier).
    // Pick the *largest* currency-like value after the "outstanding principal" label.
    const slice = t.slice(principalIdx, principalIdx + 15000);
    const re = /\$?\s*([\d,]+\.\d{2})\b/g;
    const candidates: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice)) !== null) {
      const n = parseMoneyString(m[1] ?? '');
      if (n != null && n > 0 && n < 1e9) candidates.push(n);
    }
    if (candidates.length) {
      payload.principalBalance = Math.max(...candidates);
      fieldConfidences.principalBalance = HIGH;
    } else {
      const amt = firstAmountAfter(t, principalIdx, 800);
      if (amt != null) {
        payload.principalBalance = amt;
        fieldConfidences.principalBalance = HIGH;
      }
    }
  }

  // Caliber-style statements often show `AmountDue$1,690.00` (no space between AmountDue and $).
  const amountDueMatch = t.match(/amountdue\s*\$?\s*([\d,]+\.\d{2})\b/i);
  if (amountDueMatch?.[1]) {
    const n = parseMoneyString(amountDueMatch[1]!);
    if (n != null) {
      payload.monthlyPayment = n;
      fieldConfidences.monthlyPayment = HIGH;
    }
  }

  const payIdx = tl.search(/monthly\s+payment|total\s+payment\s+due|current\s+payment|payment\s+amount|amount\s+due/);
  if (payIdx >= 0) {
    const amt = firstAmountAfter(t, payIdx, 200);
    if (amt != null) {
      payload.monthlyPayment = amt;
      fieldConfidences.monthlyPayment = MED;
    }
  }

  const setLender = (candidate: string | null, conf: number): void => {
    const normalized = normalizeLenderName(candidate);
    if (!normalized) return;
    const current = typeof payload.lenderName === 'string' ? payload.lenderName : null;
    const currentConf = fieldConfidences.lenderName ?? 0;
    // Prefer the first (higher-quality) lender capture when confidences tie.
    if (!current || conf > currentConf) {
      payload.lenderName = normalized;
      fieldConfidences.lenderName = conf;
    }
  };

  // Label-style capture.
  const lenderLabel = t.match(/(?:lender|servicer|loan\s+servicer)[^\n]*\n\s*([^\n]+)/i);
  if (lenderLabel?.[1]) {
    // Next-line after a "lender/servicer" keyword is often noisy; let brand detection win.
    setLender(lenderLabel[1], LOW_CONF);
  }

  // Common bank/servicer brands in statements.
  for (const line of lines) {
    // Credit unions (e.g. "L&N Federal Credit Union") — skip marketing / help / contact prose.
    if (
      line.length >= 12 &&
      line.length <= 100 &&
      /\bfederal\s+credit\s+union\b/i.test(line) &&
      !/\b(contact|consumerfinance|mortgagehelp|housing counselor|programs in your area)\b/i.test(line) &&
      !/\bhttps?:\/\/|www\.|\S+@\S+/i.test(line) &&
      !/\b(for a limited time|if you are set up|return this coupon)\b/i.test(line)
    ) {
      setLender(line, HIGH_NAME);
      continue;
    }

    // Prefer concise, all-caps name-like brand lines; avoid prose mentions.
    if (/caliber home loans/i.test(line)) {
      if (line.length <= 60 && /[A-Z]/.test(line) && /\b(?:inc|llc|corp|corporation|home loans)\b/i.test(line)) {
        setLender(line, HIGH_NAME);
      }
      continue;
    }

    // Homepoint / Home Point Financial (servicer branding varies; prose uses long sentences).
    if (/home\s*point/i.test(line)) {
      if (line.length <= 90 && /\bcorporation\b/i.test(line)) {
        setLender(line, STRONG_NAME);
      } else if (
        line.length <= 90 &&
        /\b(financial|inc\.?|corp\.?|llc)\b/i.test(line) &&
        !/\bis a debt collector\b/i.test(line)
      ) {
        setLender(line, HIGH_NAME);
      } else if (/^homepoint\b/i.test(line.trim()) && line.length <= 24) {
        setLender(line, MED);
      }
      continue;
    }

    // Fifth Third is sometimes extracted as "53 BANK" from statement PDFs.
    if (/\b53\s+bank\b/i.test(line) && line.length <= 40) {
      setLender(line, MED);
      continue;
    }

    if (
      /\b(rocket mortgage|wells fargo home mortgage|wells fargo|fifth\s+third|mr\. cooper|pennymac|newrez|loancare|chase|citi)\b/i.test(
        line
      )
    ) {
      setLender(line, HIGH_NAME);
    }
  }

  // Loan number: "Loan Number: 123..." or "Loan number 123..."
  const loanNum = t.match(/loan\s+number\s*[:#]?\s*([A-Z0-9\-]{6,})/i);
  if (loanNum?.[1]) {
    payload.loanNumber = loanNum[1];
    fieldConfidences.loanNumber = MED;
  }

  // Some statements use "Account Number" instead of "Loan Number".
  if (payload.loanNumber == null) {
    const accountSameLine = t.match(/account\s*number\s*[:#]?\s*([0-9][0-9\-]{5,})\b/i);
    const accountNext = accountSameLine ?? t.match(/account\s*number\s*[:#]?\s*\n\s*([0-9][0-9\-]{5,})\b/im);
    if (accountNext?.[1] && !isPlaceholderAccountId(accountNext[1]!)) {
      payload.loanNumber = accountNext[1]!.trim();
      fieldConfidences.loanNumber = LOW_CONF;
    }
  }

  if (payload.loanNumber == null) {
    const fromLines = accountNumberFromFollowingLine(lines);
    if (fromLines && !isPlaceholderAccountId(fromLines)) {
      payload.loanNumber = fromLines;
      fieldConfidences.loanNumber = LOW_CONF;
    }
  }

  // Homepoint (and similar) sometimes redact the numeric account as all one digit; a TJNUM reference line still identifies the loan.
  if (payload.loanNumber == null) {
    const tjnum = tjnumStyleReferenceFromText(t);
    if (tjnum) {
      payload.loanNumber = tjnum;
      fieldConfidences.loanNumber = LOW_CONF;
    }
  }

  const statementDateLabel =
    t.match(/statement\s+date\s*[:#]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{4}|\d{2}))/i) ??
    t.match(/\bstatement\s+date\b[^\n]*\n\s*(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{4}|\d{2}))/i);
  if (statementDateLabel?.[1]) {
    payload.statementDate = statementDateLabel[1];
    fieldConfidences.statementDate = MED;
  } else {
    const dateM = t.match(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](20\d{2})\b/);
    if (dateM) {
      payload.statementDate = dateM[0];
      fieldConfidences.statementDate = LOW_CONF;
    }
  }

  // Prefer next-line date after "Payment Due Date" (common on Caliber statements).
  const dueNextLine = t.match(
    /payment\s+due\s+date[^\n]*\n\s*(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{4}|\d{2}))/i
  );
  // Homepoint-style: label then blank lines / other fields before the due date appears.
  const dueNearPaymentDue = extractDateNearPhrase(t, 'payment due date', payload.statementDate as string | null);
  // Or parse from `AmountDueby06/01/21` style.
  const dueFromAmountDueBy = t.match(/amountdueby\s*(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{4}|\d{2}))/i);
  const dueDateInline = t.match(/due\s+date\s*[:#]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{4}|\d{2}))/i);

  const dueDateRaw =
    dueNextLine?.[1] ?? dueNearPaymentDue ?? dueFromAmountDueBy?.[1] ?? dueDateInline?.[1];
  const dueDateVal = dueDateRaw ? alignDueDateYearWithStatement(dueDateRaw, payload.statementDate as string | null) : null;
  if (dueDateVal) {
    payload.dueDate = dueDateVal;
    fieldConfidences.dueDate = dueNextLine || dueNearPaymentDue ? HIGH : MED;
  }

  if (payload.principalBalance == null) {
    // Fallback for noisy text where "Balance summary" appears before amount.
    const fallbackIdx = tl.search(/balance\s+summary/);
    if (fallbackIdx >= 0) {
      const amt = firstAmountAfter(t, fallbackIdx, 260);
      if (amt != null) {
        payload.principalBalance = amt;
        fieldConfidences.principalBalance = LOW_CONF;
      }
    }
  }

  if (payload.monthlyPayment == null) {
    // Use "amount due" if explicit monthly payment label was not detected.
    const amountDueIdx = tl.search(/amount\s+due|total\s+payment\s+due/);
    if (amountDueIdx >= 0) {
      const amt = firstAmountAfter(t, amountDueIdx, 220);
      if (amt != null) {
        payload.monthlyPayment = amt;
        fieldConfidences.monthlyPayment = LOW_CONF;
      }
    }
  }

  return { payload, fieldConfidences };
}

/** First plausible m/d/y after a heading; corrects common PDF year misreads vs statement date. */
function extractDateNearPhrase(text: string, phrase: string, statementDate: string | null): string | null {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(phrase.toLowerCase());
  if (idx < 0) return null;
  const slice = text.slice(idx + phrase.length, idx + phrase.length + 900);
  const re = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4}|\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    const raw = `${m[1]}/${m[2]}/${m[3]}`;
    const aligned = alignDueDateYearWithStatement(raw, statementDate);
    if (aligned) return aligned;
  }
  return null;
}

function statementYearFromMmddyyyy(stmt: string | null): number | null {
  if (!stmt) return null;
  const m = stmt.match(/(\d{4}|\d{2})$/);
  if (!m?.[1]) return null;
  let y = m[1]!;
  if (y.length === 2) y = (parseInt(y, 10) >= 70 ? '19' : '20') + y;
  const n = parseInt(y, 10);
  return Number.isFinite(n) ? n : null;
}

/** If due year is far from statement year (OCR/parsing), keep month/day and use statement year. */
function alignDueDateYearWithStatement(dueRaw: string, statementDate: string | null): string | null {
  const mm = dueRaw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4}|\d{2})$/);
  if (!mm) return dueRaw;
  const sep = dueRaw.includes('-') ? '-' : '/';
  const originalYearTok = mm[3]!;
  let y = originalYearTok;
  if (y.length === 2) y = (parseInt(y, 10) >= 70 ? '19' : '20') + y;
  const dueYear = parseInt(y, 10);
  if (!Number.isFinite(dueYear)) return dueRaw;
  const stmtYear = statementYearFromMmddyyyy(statementDate);
  if (stmtYear == null) return dueRaw;
  if (Math.abs(dueYear - stmtYear) <= 1) {
    // Preserve 2-digit years when they’re already consistent with the statement year.
    if (originalYearTok.length === 2) return `${mm[1]}${sep}${mm[2]}${sep}${originalYearTok}`;
    return `${mm[1]}${sep}${mm[2]}${sep}${dueYear}`;
  }
  return `${mm[1]}${sep}${mm[2]}${sep}${stmtYear}`;
}

function accountNumberFromFollowingLine(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^account\s+number\b/i.test(line)) continue;
    const sameLine = line.replace(/^account\s+number\s*[:#]?\s*/i, '').trim();
    if (/^\d[\d\-]{5,}$/.test(sameLine)) return sameLine.replace(/\s+/g, '');
    for (let j = 1; j <= 4 && i + j < lines.length; j++) {
      const rawLine = lines[i + j]!;
      const cand = rawLine.replace(/\s+/g, '').trim();
      if (!cand) continue;
      if (/^(payment|amount)\b/i.test(rawLine)) continue;
      if (/^\d[\d\-]{5,}$/.test(cand)) return cand;
    }
  }
  return null;
}

function isPlaceholderAccountId(id: string): boolean {
  const d = id.replace(/\D/g, '');
  if (d.length < 6) return true;
  if (/^(\d)\1{5,}$/.test(d)) return true;
  return false;
}

/** e.g. `1-111-TJNUM_1234567-111-2-333--444-555-666` on Homepoint statements */
function tjnumStyleReferenceFromText(text: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length < 15 || line.length > 140) continue;
    if (/\s/.test(line)) continue;
    if (!/\d+-\d+-TJNUM[_-]/i.test(line)) continue;
    return line;
  }
  return null;
}

function normalizeLenderName(input: string | null): string | null {
  if (!input) return null;
  const oneLine = input.replace(/\s+/g, ' ').trim();
  if (!oneLine || oneLine.length < 2 || oneLine.length > 140) return null;
  if (/^(loan information|payment summary|balance summary|billing statement|property address)$/i.test(oneLine)) {
    return null;
  }
  // These frequently get captured as the *next line* after a "lender" label.
  if (/^(maturity date|payment due date|account number|account information)$/i.test(oneLine)) {
    return null;
  }
  if (/^\d+$/.test(oneLine)) return null;
  return oneLine;
}
