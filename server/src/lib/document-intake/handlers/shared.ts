/** Insert space when a cents pair is immediately followed by another digit run (PDF column glue). */
export function splitConcatenatedMoneyRuns(raw: string): string {
  return raw.replace(/(\d[\d,]*\.\d{2})(?=\d)/g, '$1 ');
}

/** Parse a US-style currency string to a number. */
export function parseMoneyString(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** First currency amount after a regex match start index. */
export function firstAmountAfter(text: string, startIndex: number, window = 180): number | null {
  const slice = text.slice(Math.max(0, startIndex), startIndex + window);
  const re = /\$?\s*([\d,]+\.\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    const n = parseMoneyString(m[1] ?? '');
    if (n != null && n > 0 && n < 1e10) return n;
  }
  return null;
}

/** Any plausible currency in a line. */
export function firstAmountInLine(line: string): number | null {
  const m = line.match(/\$?\s*([\d,]+\.\d{2})\b/);
  if (!m?.[1]) return null;
  return parseMoneyString(m[1]);
}
