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
- countyId: number (court county; when the system message gives you a countyId for a named county, use it here)
- numChildren: number
- childSupportWorksheetFiled: boolean
- formTypeId: number
- petitionerId: ObjectId (ref users; the petitioner party)
- respondentId: ObjectId (ref users)
- petitionerAttId: ObjectId (ref users)
- respondentAttId: ObjectId (ref users)
- legalAssistantId: ObjectId (ref users)
- createdByUserId: ObjectId
- createdAt: Date (ISODate)
- updatedAt: Date (ISODate)
CRITICAL — "petitioners (or respondents) in [X] county": You MUST query the CASE collection with filter { "countyId": <id> }. The system will supply the county id when a county name is in the question. The answer is the list of cases in that county; petitionerId (or respondentId) on each case gives the people. Do NOT query lookup_counties for this—that returns county rows, not people. Do NOT query users by address; users have no county field.

Collection: users
- _id: ObjectId
- uname: string
- email: string
- firstName: string
- lastName: string (person's full name = firstName + lastName from this collection)
- addressLine1, addressLine2, city, state, zipCode, phone: string
- roleTypeId: number (1=Petitioner, 2=Respondent, 3=Petitioner Attorney, 4=Respondent Attorney, 5=Administrator, 6=Legal Assistant)
- createdAt, updatedAt: Date (ISODate)
CRITICAL role filters: When the question asks for "petitioners" (e.g. "petitioners who live in Florida", "show me all petitioners"), you MUST include roleTypeId: 1 in the filter when querying users. For "respondents" use roleTypeId: 2. For "petitioner attorneys" use roleTypeId: 3. For "respondent attorneys" use roleTypeId: 4. For "administrators" or "admins" use roleTypeId: 5. For "legal assistants" use roleTypeId: 6. Never return users of a different role than asked. Example: "petitioners in Florida" → users with filter { roleTypeId: 1, state: "FL" } (or state matching Florida).

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
Use lookup_counties only when you need to list or look up county names/ids for reference. Do NOT use it when the user asks for "petitioners in [X] county" or "respondents in [X] county"—for those, query case with countyId (the id will be provided in the message).

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
- name: string (EMPLOYER or organization name, e.g. "McDonald's", "Self" — NOT the person's name)
- occupation: string (optional; job title e.g. "Manager" — NOT the person's full name)
- payRate: number
- payFrequencyTypeId: number (lookup_pay_frequency_types id: 1–999)
- payFrequencyIfOther: string (optional)
- retired: boolean (optional)
To get a person's full name, query the users collection (firstName, lastName). employment.name is never the respondent/petitioner name.

For date filters use ISO strings with $gte, $lte, $gt, $lt. For ObjectId filters use the string representation.
Use projection to limit returned fields when the user asks for specific columns or "just names", etc.
Default limit to 100 unless the user asks for more (max 500).

Rule: "petitioners/respondents in [county name]" → query CASE with countyId. The system message will give you the exact countyId when a county is mentioned. Use it. Never answer that question by querying lookup_counties (you would get county rows, not people).
`.trim();
