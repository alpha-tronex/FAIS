import type { IntakeHandlerResult } from '../types.js';
import {
  firstAmountAfter,
  firstAmountInLine,
  parseMoneyString,
  splitConcatenatedMoneyRuns
} from './shared.js';

const LOW = 0.35;
const MED = 0.55;
const HIGH = 0.72;

/** Some PDFs map digits to PUA chars U+F030–U+F039 (e.g. tax year on form). */
function normalizePdfPrivateUseDigits(text: string): string {
  return text.replace(/[\uF030-\uF039]/g, (ch) => String.fromCodePoint(0x30 + (ch.codePointAt(0)! - 0xf030)));
}

/**
 * v0: best-effort from pdf-parse text. Box 1 / employer name patterns vary by issuer.
 */
export function extractW2FromText(text: string): IntakeHandlerResult {
  const t = normalizePdfPrivateUseDigits(text.replace(/\r\n/g, '\n'));
  const tl = t.toLowerCase();
  const payload: Record<string, unknown> = {
    targetWorkflow: 'employment',
    employerName: null as string | null,
    box1WagesTipsOther: null as number | null,
    taxYear: null as string | null
  };
  const fieldConfidences: Record<string, number> = {};

  const ty =
    t.match(/\b(20\d{2})\s*(?:tax\s*year|w-?2|form)/i) ||
    t.match(/tax\s*year\s*(20\d{2})/i) ||
    t.match(/wage\s+and\s+tax\s+statement[^\n]{0,120}?\b(20\d{2})\b/i);
  if (ty) {
    const y = ty[1] ?? ty[2];
    if (y && /^20\d{2}$/.test(y)) {
      payload.taxYear = y;
      fieldConfidences.taxYear = MED;
    }
  }

  if (!payload.taxYear) {
    const lone = t.match(/(?:^|\n)\s*(20\d{2})\s*(?:\n|$)/);
    const y = lone?.[1];
    if (y && /^20\d{2}$/.test(y)) {
      payload.taxYear = y;
      fieldConfidences.taxYear = LOW;
    }
  }

  const wagesIdx = tl.search(/wages,?\s*tips/);
  if (wagesIdx >= 0) {
    const deStuck = splitConcatenatedMoneyRuns(t.slice(wagesIdx, wagesIdx + 12_000));
    const amt = firstAmountAfter(deStuck, 0, deStuck.length);
    if (amt != null) {
      payload.box1WagesTipsOther = amt;
      fieldConfidences.box1WagesTipsOther = MED;
    }
  }

  const box1Line = t.match(/(?:^|\n)\s*1\s+([\d,]+\.\d{2})\s/m);
  if (box1Line?.[1]) {
    const n = parseMoneyString(box1Line[1]);
    if (n != null) {
      payload.box1WagesTipsOther = n;
      fieldConfidences.box1WagesTipsOther = HIGH;
    }
  }

  const mergedBox1 = t.match(/1\s+wages,?\s*tips[^\d]{0,180}?([\d,]+\.\d{2})\b/i);
  if (mergedBox1?.[1]) {
    const n = parseMoneyString(mergedBox1[1]);
    if (n != null) {
      payload.box1WagesTipsOther = n;
      fieldConfidences.box1WagesTipsOther = Math.max(fieldConfidences.box1WagesTipsOther ?? 0, HIGH);
    }
  }

  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const setEmployer = (candidate: string | null, conf: number): void => {
    const normalized = normalizeEmployerName(candidate);
    if (!normalized) return;
    const current = typeof payload.employerName === 'string' ? payload.employerName : null;
    const currentConf = fieldConfidences.employerName ?? 0;
    if (!current || conf >= currentConf) {
      payload.employerName = normalized;
      fieldConfidences.employerName = conf;
    }
  };

  const formStart = lines.findIndex((l, i) => {
    const win = [lines[i], lines[i + 1], lines[i + 2]].filter(Boolean).join('\n');
    return /form\s*w-?2/i.test(win) && /wage\s+and\s+tax/i.test(win);
  });
  const corpFromLines = findEmployerByCorpLine(lines, formStart >= 0 ? formStart : 0);
  if (corpFromLines) setEmployer(corpFromLines, HIGH);

  // Hyphenated EIN on its own line → employer often follows (columnar / ADP-style extracts).
  const einNext = t.match(/(?:^|\n)\s*(\d{2}-\d{7})\s*\n\s*([^\n]+?)\s*\n/i);
  if (einNext?.[2] && !payload.employerName) {
    setEmployer(einNext[2]!.trim(), MED);
  }

  // Heading with same-line or next-line value — skip box d / duplicate labels.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isEmployerHeading(line)) continue;

    const sameLine = line.replace(
      /^.*?employer['’`]?s?\s+name(?:\s*,?\s*address\s*,?\s*(?:and\s+)?zip\s*code)?\s*[:\-]?\s*/i,
      ''
    );
    if (sameLine && !isEmployerHeading(sameLine) && !isEmployerBogusCandidate(sameLine)) {
      setEmployer(sameLine, MED);
    }

    for (let j = 1; j <= 160 && i + j < lines.length; j++) {
      const cand = lines[i + j]!;
      if (isEmployerBogusCandidate(cand)) continue;
      if (isEmployerHeading(cand)) continue;
      const conf = j <= 3 ? MED : j <= 12 ? LOW : LOW * 0.9;
      const before = payload.employerName;
      setEmployer(cand, conf);
      if (payload.employerName !== before) break;
    }
  }

  // "c Employer's name..." compact variants.
  if (!payload.employerName) {
    const compact = t.match(/(?:^|\n)\s*c\.?\s*employer['’`]?s?\s+name[^\n]*\n+\s*([^\n]+)/i);
    if (compact?.[1] && !isEmployerBogusCandidate(compact[1])) setEmployer(compact[1], MED);
  }

  // Fallback: line starts with "Employer ..." and includes likely org text.
  for (const line of lines) {
    if (!/^employer/i.test(line)) continue;
    if (/identification|ein|address|zip\s*code/i.test(line)) continue;
    if (firstAmountInLine(line) != null) continue;
    const candidate = line.replace(/^employer\S*\s*/i, '').trim();
    if (isEmployerBogusCandidate(candidate)) continue;
    setEmployer(candidate, LOW);
  }

  return { payload, fieldConfidences };
}

function isEmployerHeading(line: string): boolean {
  return /\b(?:c\.?\s*)?employer['’`]?s?\s+name\b/i.test(line);
}

const CORP_TAIL =
  /\b(INC\.?|LLC|L\.L\.C\.|CORP\.?|CORPORATION|COMPANY|CO\.,|GROUP|LP|L\.P\.|PLC|LTD|SERVICES|SOLUTIONS)\b/i;

function findEmployerByCorpLine(lines: string[], startAt: number): string | null {
  for (let i = startAt; i < lines.length; i++) {
    const line = lines[i]!;
    if (isEmployerBogusCandidate(line)) continue;
    if (firstAmountInLine(line) != null) continue;
    if (!CORP_TAIL.test(line)) continue;
    const prev = i > 0 ? lines[i - 1]! : '';
    let combined = line;
    if (maybeEmployerNamePrefix(prev)) {
      combined = `${prev} ${line}`;
    }
    const n = normalizeEmployerName(combined);
    if (n) return n;
  }
  return null;
}

/** Prior line when the legal name wraps before the CORP/GROUP/SOLUTIONS tail. */
function maybeEmployerNamePrefix(prev: string): boolean {
  const s = prev.trim();
  if (s.length < 4 || s.length > 90) return false;
  if (isEmployerBogusCandidate(s)) return false;
  if (isEmployerHeading(s)) return false;
  if (firstAmountInLine(s) != null) return false;
  if (CORP_TAIL.test(s)) return false;
  if (/^\d+\s+[A-Za-z]/.test(s)) return false;
  if (/^[\d\s-]+$/.test(s)) return false;
  if (/^[A-Z][A-Za-z0-9\s.'-]+,\s*[A-Z]{2}\s+\d{5}/.test(s)) return false;
  if (!/^[A-Z]/.test(s)) return false;
  return /^[A-Z0-9][A-Z0-9 &\-',.:]{0,80}$/i.test(s);
}

function isEmployerBogusCandidate(line: string): boolean {
  const s = line.trim();
  if (!s) return true;
  if (/^corp\.?\s*employer\b/i.test(s)) return true;
  if (/employer\s+use\s+only\b/i.test(s)) return true;
  if (/^d\.?\s*control\s+number\b/i.test(s)) return true;
  if (/^b\.?\s*employer\s+identification/i.test(s)) return true;
  if (/^control\s+number\b/i.test(s)) return true;
  if (/employer['’`]?s?\s+name/i.test(s) && /address|zip\s*code/i.test(s)) return true;
  if (/^[a-h]\s*$/i.test(s)) return true;
  if (/^x+\s*$/i.test(s)) return true;
  if (/^\*{1,3}[-–]?\*{1,3}[-–]?\d{4}\b/.test(s)) return true;
  if (/^import\s+code\b/i.test(s)) return true;
  if (/^bw\d/i.test(s)) return true;
  if (/^[A-Z0-9]{6,}\s+NTF\b/i.test(s)) return true;
  return false;
}

function normalizeEmployerName(input: string | null): string | null {
  if (!input) return null;
  const oneLine = input.replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  if (oneLine.length < 2 || oneLine.length > 180) return null;
  if (isEmployerBogusCandidate(oneLine)) return null;
  if (/^employer['’`]?s?\s+name\b/i.test(oneLine) && /address|zip/i.test(oneLine)) return null;
  if (/^(address|zip|employee|wages|form\s*w-?2|box\s*\d+)\b/i.test(oneLine)) return null;
  if (/^\d+$/.test(oneLine)) return null;
  if (firstAmountInLine(oneLine) != null) return null;
  if (/^[A-Z][A-Za-z0-9\s.'-]+,\s*[A-Z]{2}\s+\d{5}/.test(oneLine)) return null;
  if (/^\d+\s+[A-Za-z]/.test(oneLine)) return null;
  return oneLine;
}
