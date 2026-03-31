import type { IntakeDocumentType } from '../../models/document-extraction.model.js';

export type { IntakeDocumentType };

/** Bumped when pipeline behavior changes (e.g. optional Textract OCR). */
export const INTAKE_PIPELINE_VERSION = 2;

export type IntakeHandlerResult = {
  payload: Record<string, unknown>;
  fieldConfidences: Record<string, number>;
};

export type TextQuality = {
  charCount: number;
  weak: boolean;
};
