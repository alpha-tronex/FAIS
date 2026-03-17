/**
 * Schema and allowed collections for the admin ad-hoc Mongo query tool.
 */

/** All queryable collections. Excludes: messages, documents, document_chunks, document_deletion_audit, ai_query_examples. */
export const ALLOWED_COLLECTIONS = [
  'case',
  'users',
  'appointments',
  'monthlyincome',
  'monthlydeductions',
  'monthlyhouseholdexpense',
  'monthlyautomobileexpense',
  'monthlychildrenexpense',
  'monthlychildrenotherrelationshipexpense',
  'monthlycreditorexpense',
  'monthlyinsuranceexpense',
  'monthlyotherexpense',
  'assets',
  'employment',
  'liabilities',
  'contingentasset',
  'contingentliability',
  'childsupportworksheet',
  'lookup_role_types',
  'lookup_counties',
  'lookup_states',
  'lookup_divisions',
  'lookup_circuits',
  'lookup_pay_frequency_types',
  'lookup_monthly_income_types',
  'lookup_monthly_deduction_types',
  'lookup_monthly_household_expense_types',
  'lookup_monthly_automobile_expense_types',
  'lookup_monthly_children_expense_types',
  'lookup_monthly_children_other_expense_types',
  'lookup_monthly_creditors_expense_types',
  'lookup_monthly_insurance_expense_types',
  'lookup_monthly_other_expense_types',
  'lookup_assets_types',
  'lookup_liabilities_types',
  'lookup_non_marital_types',
] as const;

export type AllowedCollection = (typeof ALLOWED_COLLECTIONS)[number];

/** Short schema for RAG prompt: collections and one-line descriptions. */
export const MONGO_QUERY_SCHEMA_SHORT = `
Allowed collections: ${[...ALLOWED_COLLECTIONS].join(', ')}.
- case: caseNumber, countyId, petitionerId, respondentId, petitionerAttId, respondentAttId, legalAssistantId, etc.
- users: uname, firstName, lastName, roleTypeId (1=Petitioner, 2=Respondent, 3=Petitioner Attorney, 4=Respondent Attorney, 5=Admin, 6=Legal Assistant), state, etc.
- appointments: caseId, petitionerId, scheduledAt, durationMinutes, status (pending, accepted, rejected, cancelled).
- monthlyincome, assets, employment, liabilities: userId, amount/description/marketValue etc. (affidavit data per user).
To associate any affidavit data (liabilities, assets, monthlyincome, employment) with county: link via case—case has countyId, petitionerId, respondentId. $lookup from the affidavit collection to case where petitionerId or respondentId equals userId, then $unwind (preserveNullAndEmptyArrays: false) and $group by userCase.countyId. Use the same pattern for "which counties have the most X" or "which counties have the highest average Y".
Use type "find" for simple filters; use type "aggregate" for grouping, sorting, or averaging. Use $lookup + $unwind when joining affidavit data to county via case.
When the user asks for a specific number (e.g. "which 3 counties", "list top 3 counties", "top 5", "first 10"), add a $limit stage with that number after $sort so the pipeline returns exactly that many results. For "list top N counties with highest income/most assets/most liabilities/most employment", use $limit: N in the aggregation pipeline.
In a $group stage, every field except _id must be an accumulator (e.g. $sum, $avg, $first, $last, $max, $min, $push). Do not use plain field references like "fullName": "$firstName". To include names or other fields from grouped documents, either use $first/$last (e.g. firstName: { $first: "$firstName" }) or $lookup the users collection after $group and $project the needed fields.
For "counties with most/highest amount of liabilities": $group by countyId with totalLiabilities: { $sum: 1 }, totalAmount: { $sum: '$amountOwed' }, items: { $push: { description: '$description', amount: '$amountOwed' } }; then $project with items: { $slice: ['$items', 10] } so the result includes type (description) and amount per liability.
For "counties with highest income": include income type names by $lookup from lookup_monthly_income_types (match id to typeId) first, then $lookup case for county; $group with avgIncome, totalIncome, items: { $push: { typeName: '$incomeTypeDoc.name', amount: '$amount' } }; $project with items: { $slice: ['$items', 10] } so the result includes income type description and amount.
`.trim();

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

Collection: lookup_role_types
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

Collection: liabilities
- _id: ObjectId
- userId: ObjectId (ref users; rows are per-user affidavit data)
- liabilitiesTypeId: number (lookup_liabilities_types id: 1–999)
- description: string
- amountOwed: number
- userOwes: boolean (optional)
- nonMaritalTypeId: number (optional)
- createdAt, updatedAt: Date (ISODate)

For date filters use ISO strings with $gte, $lte, $gt, $lt. For ObjectId filters use the string representation.
Use projection to limit returned fields when the user asks for specific columns or "just names", etc.
Default limit to 100 unless the user asks for more (max 500).

Rule: "petitioners/respondents in [county name]" → query CASE with countyId. The system message will give you the exact countyId when a county is mentioned. Use it. Never answer that question by querying lookup_counties (you would get county rows, not people).

CRITICAL — "case numbers involving [username]" or "cases for [username]": You MUST query the CASE collection (not users). The system message may provide the user's ObjectId; use filter { $or: [ { petitionerId: <that ObjectId> }, { respondentId: <that ObjectId> }, { petitionerAttId: <that ObjectId> }, { respondentAttId: <that ObjectId> }, { legalAssistantId: <that ObjectId> } ] }. Use projection { caseNumber: 1, division: 1, _id: 1 } to return case numbers. Do NOT query the users collection for this—that returns people, not cases.

CRITICAL — "employment/income/assets/liabilities/affidavit for [username]" or "employment on [username]": You MUST query the employment, monthlyincome, assets, or liabilities collection (not users) with filter { "userId": <that user's ObjectId> }. employment = jobs/employer/occupation/payRate; monthlyincome = income types/amounts; assets = descriptions/marketValue; liabilities = description/amountOwed (debts). To get the user's ObjectId from a username (uname), the system may provide it; otherwise the question refers to a specific person and you must filter by that userId. Do NOT query the users collection for employment/income/assets/liabilities—that returns the person record, not their affidavit data.

CRITICAL — "who has the least/highest income in [county name]" or "least/highest income in [county]": You MUST use an aggregate on monthlyincome. $lookup case with let: { userId: '$userId' }, subpipeline with $match that BOTH (1) $expr $or petitionerId/respondentId equals $$userId AND (2) countyId: <resolved countyId from system>. Then $unwind the lookup result (path must be prefixed with $ e.g. path: '$userCase'), $group by userId with totalIncome: { $sum: '$amount' }, $sort by totalIncome 1 for least or -1 for highest, $limit 1, then $lookup users to get firstName/lastName, $unwind that (path: '$userDoc'), $project firstName, lastName, totalIncome. Use the exact countyId number the system message provides for that county.
`.trim();
