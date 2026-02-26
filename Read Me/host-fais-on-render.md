# Host FAIS on Render

Deploy the FAIS monorepo (Node/Express API + Angular 21 client) as a single Render Web Service that serves both the API and the static Angular app, with MongoDB provided by Render or Atlas and required env vars configured.

---

## 1. Current architecture

- **Monorepo**: root `package.json` with `server/` (Express) and `client/` (Angular 21).
- **Server**: Express on `PORT` (default 3001), reads `MONGODB_URI`, `JWT_SECRET`, `SSN_ENCRYPTION_KEY_B64`; optional `APP_BASE_URL`, `SMTP_*`, `JWT_EXPIRES_IN`.
- **Client**: Uses `apiUrl: '/api'` in production. The server mounts the API under `/api` and serves the built Angular app for all other routes.

---

## 2. Make the server production-ready (API under `/api` + serve Angular)

- **API under `/api`**: All API routes are mounted under `/api` so the client’s `/api/...` requests hit the backend.
- **Serve Angular**: The server serves the static client build from `server/dist/public` and uses a catch-all so client-side routing works.
- **Build**: Root `build` script builds server, builds client, then copies the client build into `server/dist/public`.

---

## 3. MongoDB

- **Option A – Render MongoDB**: In the Render dashboard, add a **MongoDB** instance (if available in your plan) and use its connection string as `MONGODB_URI`.
- **Option B – MongoDB Atlas**: Create a cluster, get a connection string, and set `MONGODB_URI` in Render’s Environment tab. Allow Render’s outbound IPs or use `0.0.0.0/0` for development (tighten for production).

After first deploy, run migrations/seeds (role types, lookups, optional admin user) either via a one-off job on Render or locally with `MONGODB_URI` pointing at the same database.

---

## 4. Render Web Service setup

Create a **Web Service** and connect the FAIS GitHub repo.

| Setting | Value |
|--------|--------|
| **Root Directory** | (leave blank; repo root has `package.json`) |
| **Runtime** | Node |
| **Build Command** | `npm run render:build` (installs root + server + client deps, then builds) |
| **Start Command** | `npm run server:start` |

**Environment variables** (Render Dashboard → Environment):

- **Required**: `MONGODB_URI`, `JWT_SECRET`, `SSN_ENCRYPTION_KEY_B64` (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
- **PORT**: Set by Render automatically; server uses `process.env.PORT ?? 3001`.
- **APP_BASE_URL**: Your Render URL (e.g. `https://<service>.onrender.com`) for invite/password-reset links.
- **Optional**: `JWT_EXPIRES_IN`, and SMTP vars below if you use invite/password-reset emails.

**Sending invite and password-reset emails:** Without SMTP configured, the app still generates the correct links and logs the email body but does not send mail. To deliver emails from Render, use either:

- **Option A – SMTP URL:** `SMTP_URL` (e.g. `smtps://user:password@smtp.example.com:465`) and optionally `SMTP_FROM`. For Gmail use an [App Password](https://support.google.com/accounts/answer/185833); URL-encode special characters in the password.

- **Option B – Separate SMTP vars:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optionally `SMTP_FROM`. Example for **Yahoo**: `SMTP_HOST=smtp.mail.yahoo.com`, `SMTP_PORT=587` (or 465), `SMTP_USER=you@yahoo.com`, `SMTP_PASS=<Yahoo app password>`. **Yahoo requires the sender to be your Yahoo address:** set `SMTP_FROM=FAIS <you@yahoo.com>` or leave `SMTP_FROM` unset (the app will use `SMTP_USER` as sender). If you get **connection timeout** from Render, try port **587** instead of 465; some environments allow STARTTLS (587) when direct SSL (465) is blocked.

---

## 5. Optional: `render.yaml` (Blueprint)

You can add a `render.yaml` at the repo root to define the Web Service and env (and MongoDB if using Render’s). See [Render Blueprint Spec](https://render.com/docs/blueprint-spec). You can do the first deploy manually in the dashboard and add `render.yaml` later.

---

## 6. Post-deploy: migrations and seeds

Run once against the deployed DB (same `MONGODB_URI`):

- `npm --prefix server run migrate:seed:role-types`
- `npm --prefix server run migrate:seed:lookups`
- Optionally `migrate:seed:admin` (with `SEED_ADMIN_*` env vars set only for that run, or in Render and run via one-off job).

---

## Summary flow

```mermaid
flowchart LR
  subgraph build [Build on Render]
    A[npm install] --> B[Build server]
    B --> C[Build client]
    C --> D[Copy client to server public]
  end
  subgraph runtime [Runtime]
    E[Node server] --> F["/api/* → API"]
    E --> G["/* → static Angular"]
    E --> H[MongoDB]
  end
  build --> runtime
```
