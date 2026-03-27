import type { IntakeDocumentType } from './types.js';

/**
 * Rule + filename heuristics for v1. No ML; optional LLM can be added later.
 * Order: specific phrases before generic "statement".
 */
export function classifyIntakeDocument(text: string, originalName: string): IntakeDocumentType {
  const sample = text.slice(0, 50_000);
  const tl = sample.toLowerCase();
  const name = originalName.toLowerCase();

  if (
    /\bform\s+w-2\b|\bw-2\s+wage/i.test(sample) ||
    /wage\s+and\s+tax\s+statement/i.test(sample) ||
    (/employer(\'s)?\s+identification/i.test(sample) && /employee\'s\s+ssn|employees\s+ssn/i.test(sample))
  ) {
    return 'w2';
  }
  if (/box\s*1[^\d]{0,40}\d/.test(tl) && (/wages,\s*tips|wages\s+tips\s+other/i.test(tl) || /local\s+wages/i.test(tl))) {
    return 'w2';
  }

  if (
    /mortgage\s+statement|loan\s+statement|promissory\s+note|unpaid\s+principal\s+balance|principal\s+balance/i.test(
      sample
    ) ||
    (/escrow/i.test(sample) && /mortgage|loan|hazard\s+insurance|property\s+tax/i.test(sample))
  ) {
    return 'mortgage_statement';
  }

  if (
    /kilowatt|kwh|\bkwh\b|electric\s+service|energy\s+charge|electricity\s+consumption|meter\s+read/i.test(sample) ||
    /\bcomed\b|texas\s+utility|power\s+to\s+choose/i.test(sample)
  ) {
    return 'utility_electric';
  }

  if (
    /mastercard/i.test(sample) ||
    (/new\s+balance/i.test(sample) &&
      (/credit\s+card|minimum\s+payment|cash\s+advance|apr/i.test(sample) || /account\s+number.*\*{2,}/i.test(sample)))
  ) {
    return 'credit_card_mastercard';
  }

  return classifyFromFilename(originalName);
}

export function classifyFromFilename(originalName: string): IntakeDocumentType {
  const name = originalName.toLowerCase();

  if (/\bw-?2\b|w2-|_w2|w2_/.test(name) && !/credit|card|loan/i.test(name)) {
    return 'w2';
  }
  if (/mortgage|home\s*loan|wells.*fargo.*(mtg|mort)/i.test(name)) {
    return 'mortgage_statement';
  }
  if (/electric|comed|utility\s*bill|kwh|power\s*bill/i.test(name)) {
    return 'utility_electric';
  }
  if (/citi|capital\s*one|mastercard|credit\s*card|card\s*stmt|amex|discover|apple\s*card/i.test(name)) {
    return 'credit_card_mastercard';
  }

  return 'unknown';
}
