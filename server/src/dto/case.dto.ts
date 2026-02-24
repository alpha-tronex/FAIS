import type { UserSummaryDTO } from './user.dto.js';

export type CaseListItemDTO = {
  id: string;
  caseNumber: string;
  division: string;
  circuitId?: number;
  countyId?: number;
  numChildren?: number;
  childSupportWorksheetFiled?: boolean;
  formTypeId?: number;
  petitioner: UserSummaryDTO | null;
  respondent: UserSummaryDTO | null;
  petitionerAttorney: UserSummaryDTO | null;
  respondentAttorney: UserSummaryDTO | null;
  createdAt: string | null;
};

export type CaseDTO = {
  id: string;
  caseNumber: string;
  division: string;
  circuitId?: number;
  countyId?: number;
  numChildren?: number;
  childSupportWorksheetFiled?: boolean;
  formTypeId?: number;
  petitionerId: string | null;
  respondentId: string | null;
  petitionerAttId: string | null;
  respondentAttId: string | null;
};
