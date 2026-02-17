# FAIS Rewrite — Architecture (Normalized DTOs, Legacy Mongo)

## Goals
- Angular UI is a front-end for the existing `fais` MongoDB collections.
- Admins manage users and cases via dedicated screens.
- A generic admin console manages other whitelisted collections.
- No self-registration in production.

## Non-Goals
- No direct browser access to MongoDB (UI never connects to Mongo).
- No dedicated UI for collections ending in `Type`.

## Security Model
- Authentication: JWT (short-lived access token).
- Authorization:
  - Admin-only access for the admin console.
  - Admin/staff/user access for domain pages as needed.
- Admin console must be inaccessible to non-admin users.

## Data Model Strategy
### Normalized DTOs (App Shape)
- All API responses and requests use a normalized, friendly camelCase shape.
- Examples:
  - `firstName`, `lastName`, `roleTypeId`, `stateId`, `formTypeId`
  - never leak legacy raw keys like `Fname`, `Lname`, `RoleTypeID` to the UI

### Normalized-only Writes
- Server **writes only normalized fields** going forward.
- Server **reads legacy fields as a fallback** for older documents.
- Over time, data converges to normalized fields without a big-bang migration.

Operational note:
- The Cases API reads/writes against the legacy Mongo collection named `case` (not `cases`).

### Mapping Layer (Server-Owned)
- Implement mappers per domain entity:
  - `toUserDTO(rawDoc)` / `applyUserPatch(dto)`
  - `toCaseDTO(rawDoc)` / `applyCasePatch(dto)`
- Read rules: `normalized ?? legacy ?? default`.
- Write rules: update only normalized keys; do not update legacy keys.

## Lookup / Reference Data
Collections ending in `Type` do not get dedicated CRUD screens, but their data is used as lookups.

### Case UI lookups
- FormType, Circuit, County are integrated into the Case UI as dropdowns.

### User UI lookups
- Salutation, Gender, State are integrated into the User UI as dropdowns.

### Admin-only lookup
- UserType appears only in admin context.

## Backend (Express) Layout
### Domain APIs (hand-built)
- `Users API`
  - Admin creates users; **new user default**: `roleTypeId = 1`
  - Password reset / forced reset / role management (admin-only)
- `Cases API`
  - Case CRUD, member management, visibility rules

### Lookup APIs (read-only)
- `GET /lookups/user` → salutations, genders, states
- `GET /lookups/case` → formTypes, circuits, counties
- `GET /lookups/admin` → userTypes

### Admin Collection Manager (generic CRUD)
- Registry-driven, **whitelist only**:
  - `GET /admin/collections` → list of manageable collections + friendly labels
  - `GET /admin/collections/:name/meta` → fields, display names, types, required
  - `GET /admin/collections/:name/items` → paginated list
  - `GET /admin/collections/:name/items/:id` → detail
  - `POST/PATCH/DELETE` → admin-only mutations
- Validation:
  - Define per-collection field allowlists and basic Zod validation.
  - Hide sensitive fields (e.g., SSN, passwords, etc.) from generic UI.

## Frontend (Angular) Layout
### Core
- `AuthService` stores token, calls `/me`, handles logout on `401`.
- `ApiClient` attaches Bearer token.
- Route guards:
  - Admin guard protects `/admin/*`.

### Domain Pages
- Users page:
  - Friendly fields
  - Dropdowns for salutation/gender/state
  - Default role on create (`roleTypeId=1`)
- Cases page:
  - Friendly fields
  - Dropdowns for formType/circuit/county
  - Member management

### Admin Console
- Admin-only navigation and routes:
  - `/admin` (collection list)
  - `/admin/:collection` (list)
  - `/admin/:collection/:id` (edit)

## Observability
- Add structured logging for admin mutations.
- Return consistent error JSON: `{ error: string, details?: any }`.

## Operational Notes
- Any “bootstrap” user creation must be done through admin tooling or controlled scripts.
- Keep all admin endpoints behind `requireAuth` + `requireAdmin`.
