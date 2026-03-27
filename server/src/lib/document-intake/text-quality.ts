import type { TextQuality } from './types.js';

const MIN_CHARS = 120;
const MIN_ALNUM_RATIO = 0.25;

/** Heuristic: scanned or image-only PDFs often yield empty or garbage text from pdf-parse. */
export function assessTextQuality(text: string): TextQuality {
  const trimmed = text?.trim() ?? '';
  const charCount = trimmed.length;
  if (charCount === 0) {
    return { charCount: 0, weak: true };
  }
  const alnum = trimmed.replace(/[^a-zA-Z0-9]/g, '').length;
  const ratio = alnum / charCount;
  const weak = charCount < MIN_CHARS || ratio < MIN_ALNUM_RATIO;
  return { charCount, weak };
}
