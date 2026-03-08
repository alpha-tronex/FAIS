/**
 * Relationship graph for AI Query: explicit map of how collections link, so the LLM
 * (and optionally validation) can build correct $lookup pipelines. Used as prompt text.
 */

export type RelationshipEdge = {
  fromCollection: string;
  fromField: string;
  toCollection: string;
  toField: string;
  description?: string;
};

/** Static relationship graph: fromCollection.fromField → toCollection.toField */
export const RELATIONSHIP_EDGES: RelationshipEdge[] = [
  { fromCollection: 'case', fromField: 'petitionerId', toCollection: 'users', toField: '_id', description: 'petitioner party' },
  { fromCollection: 'case', fromField: 'respondentId', toCollection: 'users', toField: '_id', description: 'respondent party' },
  { fromCollection: 'case', fromField: 'petitionerAttId', toCollection: 'users', toField: '_id' },
  { fromCollection: 'case', fromField: 'respondentAttId', toCollection: 'users', toField: '_id' },
  { fromCollection: 'case', fromField: 'legalAssistantId', toCollection: 'users', toField: '_id' },
  { fromCollection: 'case', fromField: 'countyId', toCollection: 'lookup_counties', toField: 'id', description: 'court county' },
  { fromCollection: 'case', fromField: 'circuitId', toCollection: 'lookup_circuits', toField: 'id' },
  { fromCollection: 'appointments', fromField: 'caseId', toCollection: 'case', toField: '_id' },
  { fromCollection: 'appointments', fromField: 'petitionerId', toCollection: 'users', toField: '_id' },
  { fromCollection: 'appointments', fromField: 'petitionerAttId', toCollection: 'users', toField: '_id' },
  { fromCollection: 'appointments', fromField: 'legalAssistantId', toCollection: 'users', toField: '_id' },
  { fromCollection: 'monthlyincome', fromField: 'userId', toCollection: 'users', toField: '_id' },
  { fromCollection: 'assets', fromField: 'userId', toCollection: 'users', toField: '_id' },
  { fromCollection: 'employment', fromField: 'userId', toCollection: 'users', toField: '_id' },
  { fromCollection: 'liabilities', fromField: 'userId', toCollection: 'users', toField: '_id' },
];

/**
 * Format the relationship graph as short text for the LLM prompt.
 * Explains how to join affidavit data to county via case (userId → case petitioner/respondent → countyId).
 */
export function getRelationshipGraphText(): string {
  const lines = RELATIONSHIP_EDGES.map(
    (e) => `${e.fromCollection}.${e.fromField} → ${e.toCollection}.${e.toField}` + (e.description ? ` (${e.description})` : '')
  );
  return [
    'Relationship graph (use for $lookup):',
    ...lines,
    'To get affidavit data (monthlyincome, assets, employment, liabilities) by county: link userId to case via petitionerId/respondentId, then use case.countyId. Use $lookup from affidavit collection to case, $unwind, then $group by countyId.',
  ].join('\n');
}
