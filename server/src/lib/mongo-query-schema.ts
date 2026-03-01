/**
 * Schema description for the admin ad-hoc Mongo query tool.
 * Sent to the LLM so it generates valid collection/filter/projection/limit only.
 */

export const ALLOWED_COLLECTIONS = [
  'case',
  'users',
  'appointments',
  'roletype',
  'lookup_counties',
  'lookup_states',
  'lookup_divisions',
  'lookup_circuits',
  'monthlyincome',
  'assets',
  'employment',
] as const;

export type AllowedCollection = (typeof ALLOWED_COLLECTIONS)[number];

export const MONGO_QUERY_SCHEMA_DESCRIPTION = `
You convert natural language questions into a single MongoDB find query. Only use the query_mongodb tool.
Only query these collections. Do not hallucinate collection or field names.

Collection: case
- _id: ObjectId
- caseNumber: string
- division: string
- circuitId: number
- countyId: number
- numChildren: number
- childSupportWorksheetFiled: boolean
- formTypeId: number
- petitionerId: ObjectId (ref users)
- respondentId: ObjectId (ref users)
- petitionerAttId: ObjectId (ref users)
- respondentAttId: ObjectId (ref users)
- legalAssistantId: ObjectId (ref users)
- createdByUserId: ObjectId
- createdAt: Date (ISODate)
- updatedAt: Date (ISODate)

Collection: users
- _id: ObjectId
- uname: string
- email: string
- firstName: string
- lastName: string
- addressLine1, addressLine2, city, state, zipCode, phone: string
- roleTypeId: number (1=Petitioner, 2=Respondent, 3=Petitioner Attorney, 5=Administrator, 6=Legal Assistant)
- createdAt, updatedAt: Date (ISODate)

Collection: appointments
- _id: ObjectId
- caseId: ObjectId (ref case)
- petitionerId: ObjectId (ref users)
- petitionerAttId, legalAssistantId: ObjectId (ref users)
- scheduledAt: Date (ISODate)
- durationMinutes: number (15, 30, 45, 60)
- notes: string
- status: string ("pending", "accepted", "rejected", "cancelled", "reschedule_requested")
- createdBy: ObjectId
- createdAt, updatedAt: Date (ISODate)

Collection: roletype
- id: number
- name: string (e.g. "Administrator", "Petitioner Attorney")

Collection: lookup_counties
- id: number
- name: string
- (other fields may exist)

Collection: lookup_states
- id: number
- name: string (or code)

Collection: lookup_divisions
- id: number
- name: string

Collection: lookup_circuits
- id: number
- name: string

Collection: monthlyincome
- _id: ObjectId
- userId: ObjectId (ref users; rows are per-user affidavit data)
- typeId: number (lookup_monthly_income_types id: 1–999)
- amount: number
- ifOther: string (optional, for "other" type)

Collection: assets
- _id: ObjectId
- userId: ObjectId (ref users; rows are per-user affidavit data)
- assetsTypeId: number (lookup_assets_types id: 1–999)
- description: string
- marketValue: number
- nonMaritalTypeId: number (optional)
- judgeAward: boolean (optional)

Collection: employment
- _id: ObjectId
- userId: ObjectId (ref users; rows are per-user affidavit data)
- name: string (employer or "Self" etc.)
- occupation: string (optional)
- payRate: number
- payFrequencyTypeId: number (lookup_pay_frequency_types id: 1–999)
- payFrequencyIfOther: string (optional)
- retired: boolean (optional)

For date filters use ISO strings with $gte, $lte, $gt, $lt. For ObjectId filters use the string representation.
Use projection to limit returned fields when the user asks for specific columns or "just names", etc.
Default limit to 100 unless the user asks for more (max 500).
`.trim();
