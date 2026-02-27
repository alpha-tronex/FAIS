export type RoleTypeItem = { id: number; name: string };

// Simplified role model: a user's roleTypeId is both their application role
// and their case role.
//
// RoleTypeID 1 Petitioner
// RoleTypeID 2 Respondent
// RoleTypeID 3 Petitioner Attorney
// RoleTypeID 4 Respondent Attorney
// RoleTypeID 5 Administrator
// RoleTypeID 6 Legal Assistant
export const ROLE_TYPES: RoleTypeItem[] = [
  { id: 1, name: 'Petitioner' },
  { id: 2, name: 'Respondent' },
  { id: 3, name: 'Petitioner Attorney' },
  { id: 4, name: 'Respondent Attorney' },
  { id: 5, name: 'Administrator' },
  { id: 6, name: 'Legal Assistant' },
];
