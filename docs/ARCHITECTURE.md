# FAIS – Architecture & Design Review

This document provides a **software-architect-level** analysis of the FAIS codebase: structure, patterns, strengths, and recommended improvements.

---

## 1. High-Level Architecture

FAIS is a **full-stack web application** that replaces a legacy .NET Web Forms system:

- **Backend:** Node.js + Express 5 + TypeScript (ESM), MongoDB via Mongoose
- **Frontend:** Angular 21 (standalone-friendly, lazy-loaded feature modules)
- **Deployment:** Single process serves API under `/api` and static Angular build from `/` (SPA fallback)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Angular)                          │
│  Lazy-loaded modules: login, register, my-cases, affidavit,     │
│  admin, reports, profile, upcoming-events, reset/forgot-password  │
│  HTTP → /api/* with Bearer JWT (auth interceptor)                │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Server (Express 5)                            │
│  /api → apiRouter                                                │
│    health, role-types, auth, users, cases, lookups,              │
│    affidavit (nested: employment, assets, liabilities, …),       │
│    appointments, reports                                         │
│  Auth: JWT (requireAuth, requireAdmin, requireReportAccess)      │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  MongoDB (users, case, roletype, lookups, affidavit collections) │
│  Optional: node-cron (appointment reminders), OpenAI (reports)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend (Server) – Structure & Patterns

### 2.1 Entry Point & Bootstrap

- **`server/src/index.ts`**:
  - Loads env via `dotenv`, validates `MONGODB_URI` and `JWT_SECRET`.
  - Builds Express app: no-etag, `Cache-Control: no-store`, `express.json()`, CORS (origin: true, credentials).
  - Creates auth middlewares once, mounts all routers under `/api`.
  - Connects to MongoDB then listens; runs optional startup checks (legacy roleTypeId, empty lookups) and schedules the appointment-reminder cron.
  - Serves `dist/public` (Angular build) and SPA fallback route.

**Strengths:** Clear bootstrap, env validation at startup, no hidden globals.

### 2.2 Routing & Middleware

- **Router factory pattern:** Each domain exposes `createXxxRouter(deps): express.Router`. Dependencies (e.g. `requireAuth`, `jwtSecret`) are injected, which improves testability and keeps routes free of global config.
- **Auth:** `createAuthMiddlewares(jwtSecret)` returns `requireAuth`, `requireAdmin`, `requireStaffOrAdmin`, `requireReportAccess`. JWT payload is attached as `(req as any).auth` (see §2.6).
- **Mount order:** Health (no auth) → role-types, auth, users, cases, lookups, affidavit, appointments, reports. Affidavit sub-routes are mounted on the main affidavit router (`/affidavit/employment`, etc.).

**Strengths:** Consistent factory pattern, explicit auth per route, no global auth state.

### 2.3 Domain Layout

| Layer        | Location              | Role |
|-------------|------------------------|------|
| Routes      | `routes/*.routes.ts`   | HTTP handlers, Zod validation, call into libs/services |
| Models      | `models/*.model.ts`    | Mongoose schemas (User, Case, Appointment, role-types) |
| DTOs        | `dto/*.dto.ts`         | Contract types for API (CaseDTO, UserSummaryDTO, etc.) |
| Mappers     | `mappers/*.mapper.ts`  | DB/doc → DTO (e.g. `toUserDTO`, `toUserSummaryDTO`) |
| Lib / logic | `lib/*.ts`             | Pure or DB-backed logic (report-runner, affidavit-summary, affidavit-pdf, etc.) |
| Security    | `security/ssn-crypto.ts` | SSN encrypt/decrypt (AES-256-GCM), key from env |
| Services    | `services/*.ts`        | Cross-cutting (e.g. invite-email with nodemailer) |
| Jobs        | `jobs/*.ts`            | Scheduled tasks (e.g. appointment-reminder with node-cron) |
| Migrate/seed| `migrate/*.ts`, `seed/` | One-off scripts and seed data for DB |

**Strengths:** Separation between routes, models, DTOs, and libs is clear. Affidavit and report logic live in `lib/`, not buried in route handlers.

### 2.4 Validation & Error Handling

- **Validation:** Zod schemas in route files (e.g. `loginSchema`, `caseCreateSchema`). `safeParse` used for body/query; invalid input returns 400 with a generic or structured message.
- **Errors:** Central helpers in `routes/error.ts`: `sendError(res, e, defaultStatus)` (uses `e.status` and `e.message`) and `sendErrorWithMessage(res, message, status)`. Many routes use `try/catch` and `sendError(res, e)`.
- **Not found / business errors:** Handlers return `res.status(404).json({ error: '...' })` or throw with `status: 404` (then caught and passed to `sendError`).

**Gap:** There is **no global error-handling middleware**. Unhandled rejections or thrown errors in async route handlers could result in unformatted responses or no response. Adding an `app.use((err, req, res, next) => { ... sendError(res, err); })` after all routes would make behavior consistent.

### 2.5 Auth & Authorization

- **JWT:** Issued at login/refresh; payload includes `sub` (user id), `roleTypeId`, `uname`. Stored in client localStorage; sent as `Authorization: Bearer <token>`.
- **Role model:** `roleTypeId` 1–6 (e.g. Petitioner, Respondent, Petitioner Attorney, Respondent Attorney, Administrator, Legal Assistant). Admin = 5; report access = 3 (Petitioner Attorney) or 5.
- **Case visibility:** Implemented in route/layer logic (e.g. `canSeeCase`, `getCasesForReport`, `resolveAffidavitTarget`): admins see all; others see cases where they are petitioner, respondent, attorney, or legal assistant.

**Strengths:** Role-based checks are explicit and consistent; SSN is encrypted at rest (AES-256-GCM) and key is env-driven.

### 2.6 TypeScript & Request Extensions

- **`(req as any).auth`:** Used across routes to pass JWT payload. There is no shared `Express.Request` extension (e.g. declaration merging) so typings are ad hoc.
- **Recommendation:** Declare a global augmentation for `Express.Request` with an optional `auth?: AuthPayload` and use `req.auth` in handlers. This removes `(req as any).auth` and improves type safety.

---

## 3. Frontend (Client) – Structure & Patterns

### 3.1 App Bootstrap & Routing

- **`app.module.ts`:** Root module with `RouterModule.forRoot(routes)`, `provideHttpClient(withInterceptors([authInterceptor, unauthInterceptor]))`, and shared layout (header/footer).
- **`app.routes.ts`:** Top-level routes are lazy-loaded; guards control access (`landingGuard`, `myCasesGuard`, `adminGuard`, `reportsGuard`, `affidavitEditGuard`, `upcomingEventsGuard`, `registerGuard`).

**Strengths:** Lazy loading per feature, clear guard names and redirect targets.

### 3.2 API Access & Environment

- **Services:** Feature-specific services (e.g. `AuthService`, `CasesService`, `AffidavitService`, `ReportsService`, `AppointmentsService`) use `environment.apiUrl` (e.g. `/api`) and `HttpClient`. Token is attached by `authInterceptor` from localStorage.
- **Unauth interceptor:** Likely strips or handles 401 and redirects to login (not inspected in detail).
- **Single base URL:** All API calls go to `environment.apiUrl`; no per-endpoint env vars.

**Strengths:** Centralized API base, clear separation of auth (interceptor) and business (services).

### 3.3 State & Data Flow

- **No global store:** No NgRx or similar; state is component + service level. Auth state is effectively “token + user in memory/localStorage” and possibly refreshed via `/auth/refresh`.
- **Forms:** Reactive or template-driven forms per feature; no single form strategy mandated.

**Observation:** For current scope this is fine. If the app grows (e.g. many shared caches, optimistic updates), a small store or more formalized state layer could help.

---

## 4. Design Patterns in Use

| Pattern            | Where it appears |
|--------------------|------------------|
| **Router factory** | All `createXxxRouter(deps)` in server |
| **DTO + mapper**   | Server: DTOs in `dto/`, mappers in `mappers/` (e.g. user, case) |
| **Guard (Angular)**| Route guards for auth and role-based access |
| **Interceptor**    | Angular HTTP: auth (add Bearer), unauth (handle 401) |
| **Middleware**     | Express: auth, role checks (requireAdmin, requireReportAccess) |
| **Validation at edge** | Zod in route handlers for request bodies/params |

---

## 5. Strengths Summary

1. **Consistent API shape:** JSON, `{ error: string }` for errors, DTOs for success.
2. **Security:** JWT + role-based middleware; SSN encrypted at rest; no auth on health endpoint.
3. **Modular backend:** Routes depend on injected auth and config; libs are reusable (e.g. `report-runner`, affidavit summary/PDF).
4. **Clear split:** Server (Express + Mongoose) and client (Angular) are separate; API is the single contract.
5. **Operational hooks:** Health endpoint, startup warnings for missing seeds/roles, cron for reminders.
6. **Migration path:** Legacy JSON import and role-type migration scripts support transition from the old system.

---

## 6. Recommendations (Prioritized)

### 6.1 High impact

- **Global error handler (server):** Add an Express error-handling middleware after all routes so that any uncaught error or rejected promise returns a uniform JSON error and 500 (or preserved status). This avoids leaking stack traces and keeps behavior predictable.
- **Type `req.auth` (server):** Use declaration merging to extend `Express.Request` with `auth?: AuthPayload` and replace `(req as any).auth` with `req.auth` (and ensure middleware sets it). Reduces casting and improves safety.

### 6.2 Medium impact

- **Structured validation errors (server):** When Zod `safeParse` fails, consider returning a 400 with a small payload (e.g. `{ error: 'Validation failed', details: parsed.error.flatten() }`) so the client can show field-level errors. Keep generic message for non-development if desired.
- **Rate limiting:** Add a rate limiter (e.g. `express-rate-limit`) for `/api/auth/login` and optionally for `/api` to mitigate brute force and abuse.
- **Request ID / correlation ID:** Attach a request ID (e.g. `X-Request-Id`) in middleware and log it with every error. Eases debugging in production.

### 6.3 Lower impact / polish

- **Health dependency checks:** Optionally extend `/api/health` to check MongoDB connectivity (and optionally OpenAI) and return 503 if unhealthy, so load balancers can stop sending traffic.
- **API versioning:** If you expect breaking changes, consider a path prefix (e.g. `/api/v1`) or header from day one.
- **Client tests:** Vitest is present; expanding unit tests for guards and services (e.g. auth, reports) would increase confidence.
- **Server tests:** Adding a small test suite for critical routes (auth, cases, report runner) and for `sendError` behavior would help refactors.

---

## 7. Dependency Overview

- **Server:** express, mongoose, zod, jsonwebtoken, bcrypt, cors, dotenv; optional: openai, nodemailer, node-cron, pdf-lib, playwright; dev: tsx, typescript.
- **Client:** Angular 21 (core, common, forms, router, platform-browser), rxjs; dev: vitest, jsdom.

No major architectural red flags. Ensure `OPENAI_API_KEY` and `SSN_ENCRYPTION_KEY_B64` are never committed and are set in production.

---

## 8. Quick Reference (Key Paths)

| Concern | Server | Client |
|--------|--------|--------|
| Entry | `server/src/index.ts` | `client/src/main.ts` → `AppModule` |
| API routes | `server/src/routes/*.routes.ts` | — |
| Auth middleware | `server/src/routes/middleware.ts` | `client/src/app/core/auth.interceptor.ts` |
| Guards | — | `client/src/app/core/*.guard.ts` |
| Models | `server/src/models/*.model.ts` | — |
| DTOs | `server/src/dto/*.dto.ts` | Types in services (e.g. `AuthService`) |
| Business logic | `server/src/lib/*.ts` | Services under `client/src/app/services/` |
| App routing | — | `client/src/app/app.routes.ts` |

---

## 9. Conclusion

FAIS is structured as a **classic three-tier web app** (Angular → Express → MongoDB) with clear separation of routes, models, DTOs, and business logic. The use of router factories, Zod, and role-based middleware makes the backend maintainable and testable. The main improvements to aim for are a **global error handler**, **typed `req.auth`**, and optional **rate limiting** and **richer validation responses**. The rest is incremental (health checks, versioning, tests) as the product and team grow.
