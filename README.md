# FAIS

Node.js (Express + TypeScript) backend + Angular frontend rewrite of the legacy FAIS (.NET Web Forms) app.

## Prereqs
- Node.js + npm
- MongoDB (local install) OR Docker Desktop (optional)

## Local dev (macOS)

### 1) Run MongoDB locally
If you’re using Homebrew:

```bash
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
```

Mongo will listen on `mongodb://127.0.0.1:27017` by default.

(Alternative) If you prefer Docker:

```bash
docker compose up -d
```

Note: Docker compose maps Mongo to `mongodb://127.0.0.1:27018` to avoid conflicts if you already have a local `mongod` listening on 27017.

### 2) Configure the API env vars
Copy the example env file and tweak as needed:

```bash
npm run setup:dev
```

### 3) Install deps

```bash
npm install
npm --prefix server install
npm --prefix client install
```

### 4) Start everything

```bash
npm run dev
```

If you want to start the UI even when Mongo isn’t up yet:

```bash
npm run dev:nocheck
```

- API: `http://localhost:3001/health`
- Web UI: `http://localhost:4200/`

## Build

```bash
npm run build
```

## Notes
- There is no public self-registration endpoint.
- Create users from the UI (admin-only) and users will be forced to reset their password.

## Migration: import legacy JSON

The server includes a CLI to import JSON exports from the legacy SQL Server schema.

### Expected files

All files should be **JSON arrays** of objects.

- **Users** (example keys the importer recognizes)
	- `UserID`, `Uname`, `Email`, `RoleTypeID`, `Fname`, `Lname`
- **Cases**
	- `CaseID`, `CaseNumber`, `Division`, `CircuitID`, `CountyID`, `NumChildren`, `FormTypeID`
	- Optional but strongly recommended (for correct visibility rules):
		- `PetitionerID`, `RespondentID`, `PetitionerAttID`, `RespondentAttID`
- **Case ↔ User links** (optional)
	- `CaseID`, `UserID`, `UserTypeID` (maps into the Case `members` array)

### Run the importer

From the repo root:

```bash
npm run migrate:import:legacy-json -- \
	--users path/to/users.json \
	--cases path/to/cases.json \
	--case-users path/to/case_user_lu.json \
	--created-by-uname admin \
	--dry-run
```

Then run it for real (optionally wiping current data):

```bash
npm run migrate:import:legacy-json -- \
	--users path/to/users.json \
	--cases path/to/cases.json \
	--case-users path/to/case_user_lu.json \
	--created-by-uname admin \
	--wipe
```

Notes:
- `--case-users` is optional; omit it if you don’t have `Case_User_lu` exported yet.
- The importer matches existing users by `uname` or `email`, and cases by `caseNumber`.

## Migration: export legacy SQL → JSON

If your legacy data lives in SQL Server (the original FAIS schema), you can export the key tables to JSON and then feed those JSON files into the importer.

You do **not** need SQL Server installed on your Mac to do this, as long as you can connect to a SQL Server instance over the network (VPN/remote host).

Important: the repo’s legacy SQL scripts in the old FAIS project (`FAIS/sql scripts/`) appear to be **schema only** (tables/constraints/indexes) and do **not** include production data. To migrate real records, you’ll still need either:
- A reachable legacy SQL Server database that already contains the data, or
- A backup/export (e.g. `.bak` / `.bacpac`) restored into a SQL Server instance.

### 1) Set the legacy SQL connection string

Set `LEGACY_SQLSERVER_CONNECTION_STRING` (or `LEGACY_SQLSERVER_URL`) in your environment. Example:

```bash
export LEGACY_SQLSERVER_CONNECTION_STRING='Server=tcp:HOST,1433;Database=financialAff;User Id=USERNAME;Password=PASSWORD;Encrypt=true;TrustServerCertificate=true;'
```

If you’re using the local Docker SQL Server (see below), you can omit `Database=...` and let the schema-applier create it:

```bash
export LEGACY_SQLSERVER_CONNECTION_STRING='Server=tcp:127.0.0.1,1433;User Id=sa;Password=ChangeMe123!;Encrypt=false;TrustServerCertificate=true;'
```

### (Optional) Run SQL Server locally via Docker

The repo includes a SQL Server service in `docker-compose.yml`.

```bash
export MSSQL_SA_PASSWORD='ChangeMe123!'
docker compose up -d sqlserver
```

If you have an existing legacy database as `financialAff.mdf` + `financialAff_log.ldf`, you can attach it to the container.

### Legacy export/import (retired)

The project no longer uses SQL-to-JSON legacy export/import flows.

The folder [legacy-export/](legacy-export/) is now kept only as an archived snapshot of the old system’s JSON dumps.
It is not required to run the normalized app.

If you want a clean, normalized database, use the server reset/seed scripts instead (destructive):

```bash
# from repo root
npm run db:reset:clean

# or directly
MONGODB_URI='mongodb://127.0.0.1:27017/fais' npm -C server run migrate:reset:clean -- --drop
```

