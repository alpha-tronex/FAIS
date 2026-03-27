import type { IntakeDocumentType, IntakeHandlerResult } from '../types.js';
import { extractW2FromText } from './w2.js';
import { extractMortgageFromText } from './mortgage.js';
import { extractUtilityElectricFromText } from './utility-electric.js';
import { extractCreditCardMastercardFromText } from './credit-card.js';

export function runIntakeHandler(
  documentType: IntakeDocumentType,
  text: string,
  originalName: string
): IntakeHandlerResult {
  switch (documentType) {
    case 'w2':
      return extractW2FromText(text);
    case 'mortgage_statement':
      return extractMortgageFromText(text);
    case 'utility_electric':
      return extractUtilityElectricFromText(text);
    case 'credit_card_mastercard':
      return extractCreditCardMastercardFromText(text);
    default: {
      return {
        payload: {
          targetWorkflow: 'unknown',
          hint: 'Document type unknown; manual entry required.',
          originalFileName: originalName
        },
        fieldConfidences: {}
      };
    }
  }
}
