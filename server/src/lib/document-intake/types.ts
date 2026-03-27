import type { IntakeDocumentType } from '../../models/document-extraction.model.js';

export type { IntakeDocumentType };

export const INTAKE_PIPELINE_VERSION = 1;

export type IntakeHandlerResult = {
  payload: Record<string, unknown>;
  fieldConfidences: Record<string, number>;
};

export type TextQuality = {
  charCount: number;
  weak: boolean;
};
