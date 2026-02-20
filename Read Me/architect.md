# FAIS — Architecture (Normalized DTOs, Legacy Mongo)

## Goals
- Angular UI is a front-end for the existing `fais` MongoDB collections.
- Admins manage users and cases via dedicated screens.
- Users manage their own cases (My Cases), profile, and financial affidavits.
- No self-registration in production (register exists for onboarding; can be disabled).

## Non-Goals
- No direct browser access to MongoDB (UI never connects to Mongo).
- No dedicated UI for collections ending in `Type` (used only as lookups).
- Generic admin collection manager (e.g. `/admin/collections`) is **not implemented**; admin UI is domain-specific (Users, Cases, Affidavit).

## Security Model
- **Authentication:** JWT (short-lived access token, 15m). Token stored client-side; `AuthService` calls `/me`, handles logout on 401.
- **Authorization:**
  - **Admin (roleTypeId = 5):** Full access to admin area (users, cases, affidavit on behalf of users).
  - **Staff:** Currently treated same as admin via `requireStaffOrAdmin`.
  - **User:** Own profile, my-cases, affidavit (own data only).
- Admin area is protected by `adminGuard` + `adminChildGuard`; non-admins are redirected to `/my-cases`.

## Data Model Strategy
### Normalized DTOs (App Shape)
- All API responses and requests use a normalized, friendly camelCase shape.
- Examples: `firstName`, `lastName`, `roleTypeId`, `stateId`, `formTypeId` — never leak legacy raw keys like `Fname`, `Lname`, `RoleTypeID` to the UI.

### Normalized-only Writes
- Server **writes only normalized fields** going forward.
- Server **reads legacy fields as a fallback** for older documents.
- Over time, data converges to normalized fields without a big-bang migration.

**Operational note:** The Cases API reads/writes against the legacy Mongo collection named `case` (not `cases`).

### Mapping Layer (Server-Owned)
- Mappers per domain entity: e.g. `toUserDTO(rawDoc)` / `applyUserPatch(dto)`, `toCaseDTO(rawDoc)` / `applyCasePatch(dto)`.
- Read rules: `normalized ?? legacy ?? default`.
- Write rules: update only normalized keys; do not update legacy keys.

### SSN Handling
- SSN is encrypted at rest (AES-256-GCM). Requires `SSN_ENCRYPTION_KEY_B64`. Legacy plaintext SSN is migrated on-demand when user accesses `/me/ssn`.

---

## Lookup / Reference Data
Collections ending in `Type` (and other lookup collections) do not have dedicated CRUD screens; they are exposed as read-only lookups.

### Lookup API (implemented)
- **Public:** `GET /lookups/states` — used for registration (no auth).
- **Authenticated:** `GET /lookups/:name` — `name` is one of:
  - **Case/affidavit:** `divisions`, `circuits`, `counties`, `states`
  - **Affidavit:** `pay-frequency-types`, `monthly-income-types`, `monthly-deduction-types`, `monthly-household-expense-types`, `assets-types`, `liabilities-types`, `non-marital-types`

Backend maps these to Mongo collections (e.g. `lookup_divisions`, `lookup_circuits`, `lookup_counties`, etc.).

### Case UI lookups
- FormType, Circuit, County (and Division) are integrated into the Case UI as dropdowns.

### User UI lookups
- State (and Salutation, Gender if used) for User/Profile/Registration.

### Admin-only lookup
- Role types: `GET /role-types` (auth). UserType can appear in admin context.

---

## Backend (Express) Layout

### Mounted Routers (see `server/src/index.ts`)
| Router            | Path base   | Auth / role          |
|-------------------|------------|----------------------|
| Health            | (none)     | None                 |
| Role types        | (none)     | requireAuth          |
| Auth              | (none)     | per-route            |
| Users             | (none)     | requireAuth + requireAdmin for mutations |
| Cases             | (none)     | requireAuth, requireStaffOrAdmin |
| Lookups           | (none)     | /lookups/states public; /lookups/:name requireAuth |
| Affidavit         | (none)     | requireAuth (admin can use ?userId=) |

### Domain APIs (hand-built)

**Auth API**
- `POST /auth/login` — returns `{ token, mustResetPassword, user }`.
- `POST /auth/register` — self-registration (standard user, roleTypeId=1); SSN encrypted.
- `POST /auth/change-password` — requireAuth; used for forced reset and normal password change.
- `GET /me`, `PATCH /me` — current user profile (normalized DTO).
- `GET /me/ssn`, `PATCH /me/ssn` — SSN view/update (decrypt/encrypt).

**Users API**
- Admin creates users; **new user default:** `roleTypeId = 1`, `mustResetPassword = true`.
- Invite email sent on user create (see `invite-email.service`); optional, best-effort.
- Password reset / forced reset / role management (admin-only).
- List: `GET /users`; Create: `POST /users`; Update: `PATCH /users/:id`; Delete, SSN update, force reset, etc.

**Cases API**
- Case CRUD; member management (petitioner, respondent, petitionerAtt, respondentAtt); visibility rules so only participants and admins see a case.
- Uses `case` collection; user references by ObjectId.

**Role types**
- `GET /role-types` — returns list `{ id, name }` from `roletype` collection or in-code fallback.

**Affidavit API**
- **Summary:** `GET /affidavit/summary` — short vs long form threshold (e.g. $50k), gross income; optional `?userId=` for admin.
- **PDF:**  
  - `GET /affidavit/pdf` — HTML-based PDF (Playwright); optional `?form=auto|short|long`, `?userId=` for admin.  
  - `GET /affidavit/pdf-template` — fill official AcroForm PDF (pdf-lib); same query params; optional `?caseId=` for caption.  
  - `GET /affidavit/pdf-template/fields` — inspect template field names (dev/debug).
- **CRUD by section (all requireAuth; admin may pass `?userId=`):**
  - Employment: `GET/POST /affidavit/employment`, `PATCH/DELETE /affidavit/employment/:id`
  - Monthly income: `GET/POST /affidavit/monthly-income`, `PATCH/DELETE /affidavit/monthly-income/:id`
  - Monthly deductions: same for `/affidavit/monthly-deductions`
  - Monthly household expenses: same for `/affidavit/monthly-household-expenses`
  - Assets: same for `/affidavit/assets`
  - Liabilities: same for `/affidavit/liabilities`
- Affidavit data is stored in Mongo collections: `employment`, `monthlyincome`, `monthlydeductions`, `monthlyhouseholdexpense`, `assets`, `liabilities` (raw collections, no Mongoose models). Scoped by `userId`.

### Admin Collection Manager (generic CRUD)
- **Not implemented.** The doc previously described a registry-driven whitelist (`GET /admin/collections`, `/admin/collections/:name/meta`, `/admin/collections/:name/items`, etc.). The current app uses only domain-specific admin screens (Users, Cases, Affidavit). If added later, keep it admin-only with per-collection allowlists and sensitive-field hiding.

---

## Frontend (Angular) Layout

### Core
- **AuthService:** Stores token, calls `/me`, handles logout on 401; `getToken` / `setToken` used by interceptor.
- **Auth interceptor:** Attaches Bearer token to API requests.
- **Route guards:**
  - **landingGuard:** If not logged in → `/login`; if must complete registration → `/register`; else admin → `/admin`, else → `/my-cases`.
  - **adminGuard / adminChildGuard:** Require login and admin; else redirect to `/login` or `/register` or `/my-cases`.
  - **myCasesGuard:** Require login; if admin → redirect to `/admin`; else allow My Cases.

### Routes (see `app.routes.ts`)
| Path                | Guard          | Component / behavior                          |
|---------------------|----------------|-----------------------------------------------|
| `''`                | landingGuard   | LoginPage                                     |
| `login`             | —              | LoginPage                                     |
| `register`          | —              | RegisterPage                                  |
| `reset`             | —              | ResetPage (forced password change)            |
| `my-cases`          | myCasesGuard   | MyCasesPage                                   |
| `affidavit`         | —              | AffidavitPage                                 |
| `affidavit/edit`    | —              | AffidavitEditPage                             |
| `profile`           | —              | ProfilePage (own profile)                     |
| `admin`             | adminGuard     | AdminPage (shell)                             |
| `admin` (children)  | adminChildGuard| —                                             |
| ↳ `admin/users`     | —              | UsersPage                                     |
| ↳ `admin/users/:id/profile` | —       | ProfilePage (view/edit user)                  |
| ↳ `admin/cases`     | —              | CasesPage                                     |
| ↳ `admin/affidavit` | —              | AdminAffidavitPage                            |
| `users`             | —              | Redirect to `admin/users`                     |
| `cases`             | —              | Redirect to `my-cases`                        |
| `**`                | —              | Redirect to `''`                              |

### Domain Pages
- **Users page (admin):** Friendly fields; dropdowns for salutation/gender/state as needed; default role on create (`roleTypeId=1`).
- **Cases page (admin):** Case list/detail; dropdowns for formType/circuit/county/division; member management (petitioner, respondent, attorneys).
- **My Cases:** Cases where the current user is a participant; entry point for non-admin users.
- **Affidavit:** View summary, generate PDF; **Affidavit edit:** sections for employment, monthly income/deductions/household expenses, assets, liabilities (with lookups).
- **Admin Affidavit:** Same affidavit flows with ability to select user (admin-only).
- **Profile:** Own profile or, under `admin/users/:id/profile`, another user’s profile (admin).

### Admin Console
- Admin-only navigation and routes under `/admin`:
  - `/admin` → redirects to `admin/users`.
  - `/admin/users`, `/admin/users/:id/profile`, `/admin/cases`, `/admin/affidavit`.
- No generic collection list/edit UI.

---

## Observability
- Add structured logging for admin mutations where useful.
- Return consistent error JSON: `{ error: string, details?: any }`.

## Operational Notes
- Bootstrap user creation via admin tooling or controlled scripts (e.g. `migrate/seed-admin-user.ts`).
- All admin endpoints behind `requireAuth` + `requireAdmin` (or `requireStaffOrAdmin` for cases).
- Optional env: `APP_BASE_URL` for invite emails; `SSN_ENCRYPTION_KEY_B64` required for SSN; `JWT_SECRET`, `MONGODB_URI` required.
- Migrations: e.g. `migrate:seed:role-types`, `migrate:seed:lookups`, `migrate:role:admin-4-to-5`; see `package.json` scripts and server startup warnings.
