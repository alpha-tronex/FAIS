# FAIS Mongo Collections — Inventory & UI Coverage

This document turns Milestone 0 into a concrete starting point.

## Source of Truth
- Normalized seed JSON committed under: `server/src/seed/lookups/*.json`
- Current Mongo DB: `mongodb://127.0.0.1:27017/fais`

## Naming
- Normalized lookups live in `lookup_*` collections (e.g., `lookup_counties`).
- Domain collections use normalized fields (camelCase).

## UI Rules (as agreed)
- Collections ending in `Type` do **not** get a dedicated UI page.
- Case UI includes these lookups: `formtype`, `circuit`, `county`.
- User UI includes these lookups: `salutation`, `gender`, `states`.
- New users default to `roleTypeId = 1`.
- `usertype` appears only in the **admin console**.
- Non-admins must never access `/admin/*`.

## Categories

### A) Dedicated domain pages
These get hand-built Angular pages and custom APIs.

- `users` (21 docs)
- `case` (5 docs)

### B) Lookups (no dedicated UI pages)
These are used as dropdown/reference data in domain pages.

**User page lookups**
- `lookup_divisions`
- `lookup_circuits`
- `lookup_counties`
- `lookup_pay_frequency_types`
- `lookup_monthly_income_types`
- `lookup_monthly_deduction_types`
- `lookup_monthly_household_expense_types`
- `lookup_assets_types`
- `lookup_liabilities_types`
- `lookup_non_marital_types`
- `roletype` (role dropdown; create defaults to 1)

**Case page lookups**
- `lookup_divisions`
- `lookup_circuits`
- `lookup_counties`

### C) Admin-only lookups
- (none)

### D) Generic admin-managed collections (candidate whitelist)
These are non-`Type` collections that can be managed through the registry-driven admin console (list/edit/create), using friendly normalized DTOs.

- `assets`
- `employment`
- `employmentstatus`
- `filingstatus`
- `liabilities`
- `monthlyautomobileexpense`
- `monthlychildrenexpense`
- `monthlychildrenotherrelationshipexpense`
- `monthlycreditorsexpense`
- `monthlydeductions`
- `monthlyhouseholdexpense`
- `monthlyincome`
- `monthlyinsuranceexpense`
- `monthlyotherexpense`
- `exceptiondata`

Notes:
- Many of these have a companion `*type` collection; the generic UI should show the foreign-key ID field (normalized) and optionally render friendly names by joining lookup data.

### E) Excluded / system
- `sysdiagrams` (system)
- `cases` (currently empty; kept unused for now)

## Legacy exports (archived)
The folder [legacy-export/](legacy-export/) contains archived JSON exports from the old SQL system.
It is not used by the normalized app and can be deleted if you don’t need it for reference.

- `Assets`
- `AssetsType`
- `Case`
- `Circuit`
- `County`
- `Employment`
- `EmploymentChangeStatusType`
- `EmploymentStatus`
- `EmploymentStatusType`
- `ExceptionData`
- `FilingStatus`
- `FilingStatusType`
- `FormType`
- `Gender`
- `Liabilities`
- `LiabilitiesType`
- `MonthlyAutomobileExpense`
- `MonthlyAutomobileExpenseType`
- `MonthlyChildrenExpense`
- `MonthlyChildrenExpenseType`
- `MonthlyChildrenOtherRelationshipExpense`
- `MonthlyChildrenOtherRelationshipExpenseType`
- `MonthlyCreditorsExpense`
- `MonthlyCreditorsExpenseType`
- `MonthlyDeductions`
- `MonthlyDeductionsType`
- `MonthlyHouseholdExpense`
- `MonthlyHouseholdExpenseType`
- `MonthlyIncome`
- `MonthlyIncomeType`
- `MonthlyInsuranceExpense`
- `MonthlyInsuranceExpenseType`
- `MonthlyOtherExpense`
- `MonthlyOtherExpenseType`
- `NonMaritalType`
- `PayFrequencyType`
- `RoleType`
- `UserType`
- `Users`
- `sysdiagrams`

## Recommended next decision
To keep the system conceptually clean, pick one of these:

1) **Point the app to legacy collections**
   - Done: the server reads/writes cases from the legacy `case` collection (normalized-only writes; legacy fields are preserved).

2) **Migrate legacy → app collections**
   - Write a one-time script to convert legacy `case` docs into normalized `cases` docs (with membership arrays, createdByUserId, etc.).

Given your stated goal (“purely a front end for each collection”), option (1) is usually the most direct.
