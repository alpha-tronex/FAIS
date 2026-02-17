export function asNonEmptyString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export function asFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function pickFirstString(...values: unknown[]): string | null {
  for (const v of values) {
    const s = asNonEmptyString(v);
    if (s) return s;
  }
  return null;
}

export function pickFirstNumber(...values: unknown[]): number | null {
  for (const v of values) {
    const n = asFiniteNumber(v);
    if (n != null) return n;
  }
  return null;
}
