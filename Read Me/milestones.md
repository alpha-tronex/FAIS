# FAIS Rewrite — Milestones

This plan implements a normalized API/UI on top of legacy Mongo collections with **normalized-only writes**.

## Milestone 0 — Collection Inventory & Rules (0.5–1 day)
**Deliverables**
- List all `fais` collections.
- Mark each as: `domain` (users/cases), `lookup`, `admin-managed`, or `excluded`.
- Apply rules:
  - Collections ending in `Type` have **no dedicated UI**.
  - FormType/Circuit/County are used in the Case UI.
  - Salutation/Gender/State are used in the User UI.
  - UserType appears only in admin context.

**Exit criteria**
- Approved whitelist for admin console + lookup list + excluded list.

Reference: [Read Me/collections.md](collections.md)

## Milestone 1 — Define DTOs + Mapping Layer (1 day)
**Deliverables**
- DTO contracts (TypeScript types) for:
  - `UserDTO`, `CaseDTO`, lookup DTOs
- Server mappers:
  - Read: `normalized ?? legacy ?? default`
  - Write: normalized-only

**Exit criteria**
- API can return normalized DTOs without leaking legacy keys.

## Milestone 2 — Lookups API + Angular Services (1–2 days)
**Deliverables**
- Backend endpoints:
  - `GET /lookups/user` (salutations, genders, states)
  - `GET /lookups/case` (formTypes, circuits, counties)
  - `GET /lookups/admin` (userTypes)
- Angular lookup services to fetch/cache dropdown data.

**Exit criteria**
- Dropdowns can be populated from real DB data.

## Milestone 3 — Users Admin (2–4 days)
**Deliverables**
- Users API uses normalized DTOs.
- Create user defaults: `roleTypeId = 1`.
- Admin-only actions:
  - create user
  - update user profile fields
  - change role
  - reset password / force reset
- User UI uses lookup dropdowns for salutation/gender/state.

**Exit criteria**
- Admin can fully manage users using only the UI.

## Milestone 4 — Cases Admin (3–6 days)
**Deliverables**
- Cases API uses normalized DTOs.
- Case UI integrates:
  - formType, circuit, county dropdowns
- Membership management:
  - add/remove members
  - enforce visibility rules
- Ensure userType is only displayed in admin context (as required).

**Exit criteria**
- Admin can create/update cases and manage case members from the UI.

## Milestone 5 — Admin Console Shell (1–2 days)
**Deliverables**
- Angular `/admin` route tree.
- Admin guard ensures non-admins cannot access admin console.
- Basic admin navigation.

**Exit criteria**
- Non-admins are blocked from admin console routes.

## Milestone 6 — Registry-Driven Collection Manager (4–7 days)
**Deliverables**
- Backend collection registry (whitelist) with friendly field labels + field types.
- Generic admin endpoints:
  - list collections + metadata
  - list items (pagination)
  - create/update/delete items
- Angular generic screens:
  - collection list
  - item list/table
  - item editor (dynamic form)

**Exit criteria**
- At least 3 non-`Type` collections are manageable end-to-end without writing new Angular pages.

## Milestone 7 — Batch Onboarding Remaining Collections (ongoing)
**Deliverables**
- Add collections to the registry in batches.
- Add basic validation + hide sensitive fields.

**Exit criteria**
- New collections become available via configuration changes (registry) rather than new custom UI.

## Optional — Backfill Normalized Fields (0.5–2 days)
**Deliverables**
- One-time script to populate normalized fields from legacy keys for existing docs.

**Exit criteria**
- Majority of documents contain normalized fields, reducing fallback reads.
