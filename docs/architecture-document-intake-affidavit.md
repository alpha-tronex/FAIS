# Architecture: Document Intake → Affidavit Prefill

This document describes a planned architecture to let users upload financial documents (PDFs), extract structured data (including scanned or layout-heavy PDFs), map that data into FAIS affidavit workflows (employment, liabilities, monthly household expenses, and related sections), and apply changes after human review.

It complements the existing **Documents** feature (B2 storage → `pdf-parse` → chunk → embed → admin Q&A), which is optimized for retrieval, not structured form population.

---

## 1. Goals

- **Reduce retyping** from common financial PDFs into affidavit sections.
- **Handle real-world PDFs**: digital text, poor OCR from scans, multi-column layouts, and tables.
- **Human-in-the-loop (HITL)**: staff approve or edit before data is written to affidavit collections or used in PDF generation.
- **Auditability**: tie proposed values to `documentId`, extraction version, and optional source snippets.

Non-goals for v1:

- Fully automatic filing without review.
- Replacing the existing vector-search Q&A pipeline (may coexist).

---

## 2. High-Level Flow

```
Upload (existing or dedicated endpoint)
    → Store blob (B2) + Document metadata
    → Job: classify document type (W-2, pay stub, CC statement, mortgage, utility, unknown)
    → Job: extract text / rasterize pages → OCR or document AI as needed
    → Structured extraction (type-specific mapper or LLM with JSON schema)
    → Persist proposed_extractions (status: pending_review)
    → UI: review screen per case/user
    → On accept: write to affidavit APIs (employment, liabilities, monthly lines, …)
    → Optional: audit log entry
```

Existing **affidavit PDF generation** (`fillOfficialAffidavitPdf`, employment routes, etc.) continues to read from Mongo as today; this feature **feeds** those collections with cleaner input.

---

## 3. Components

### 3.1 Ingestion

- **Reuse** current upload path (`POST /cases/:caseId/documents`) or add `POST .../documents/intake` with explicit `purpose=intake_suggestion` if you need different retention or processing flags.
- Store **original PDF** in B2; record `caseId`, `uploadedBy`, `originalName`, `mimeType`, `size`.

### 3.2 Classification

- **Input**: first pages as images and/or extracted text.
- **Output**: `documentType` enum (e.g. `w2`, `pay_stub`, `credit_card_statement`, `mortgage`, `utility`, `unknown`).
- **Implementation options**: lightweight classifier (embeddings + logistic layer), rules on keywords, or small LLM call with constrained labels. Start with **rules + one LLM fallback** for `unknown`.

### 3.3 Text vs scan routing

- Try **text layer** (`pdf-parse` or `pdftotext`) per document or per page.
- **Heuristics**: empty text, very short text, high non-alphanumeric ratio → treat as scan.
- **Scans**: rasterize pages (e.g. `pdftoppm` / `pdf2image` in worker) → **OCR** (Tesseract) or **managed API** (AWS Textract, Azure Document Intelligence, Google Document AI).

Recommendation for production: **managed document AI or Textract** for tables and key-value pairs on statements; **Tesseract** as dev/low-cost fallback.

### 3.4 Structured extraction

- **Per-type handlers** (strategy pattern):

  | Handler            | Primary signals                          | Maps to (examples)                    |
  |--------------------|------------------------------------------|----------------------------------------|
  | W-2                | IRS box layout, employer name            | Employment: employer name, wages basis |
  | Credit card      | Statement tables, balance              | Liabilities: creditor, balance         |
  | Mortgage           | Lender, principal, payment             | Liabilities + optional expense split   |
  | Utility            | Amount due, period, vendor               | Monthly household expense type         |

- **LLM assist**: JSON schema output with `confidence` per field; validate with **zod**/JSON Schema on server.
- **Normalization**: currency, dates, annual vs monthly (explicit product rules—W-2 is often annual; affidavit may need monthly equivalents).

### 3.5 Persistence (new collections recommended)

- **`document_extractions`** (or subdocument on `documents`):

  - `documentId`, `caseId`, `userId` (affidavit subject), `documentType`, `status` (`pending_review` | `applied` | `rejected` | `failed`),
  - `rawPayload` (structured JSON),
  - `fieldConfidences`, `extractionVersion`, `errorMessage`, timestamps.

- **`extraction_audit_logs`** (optional): who accepted/edited each field.

Avoid writing directly to affidavit rows until **Apply** is confirmed.

### 3.6 Review UI (client)

- Route under **affidavit edit** or **documents**: “Suggestions from uploads” with side-by-side (snippet + proposed value).
- Actions: **Apply all**, **Apply field**, **Discard**, **Edit then apply**.
- Calls new server endpoints: `GET` proposals, `POST` apply (transactional writes to existing affidavit services).

### 3.7 Apply → existing APIs

- Reuse **`affidavit-employment`**, **liabilities**, **monthly income/deductions/household expense** routes internally (service layer), not ad-hoc Mongo writes, so validation and user scoping stay consistent.

---

## 4. Workers and Infrastructure

- **Queue**: Redis/BullMQ, SQS, or Mongo-backed job collection for async **classify → extract → persist**.
- **Idempotency**: processing keyed by `documentId` + `extractionVersion`.
- **Secrets**: vendor API keys for OCR/document AI in env (same pattern as `OPENAI_API_KEY`).

---

## 5. Security and Compliance

- **Access control**: same case access as document list/download; extraction visible only to authorized roles (petitioner, attorneys, admin as per product policy).
- **PII**: minimize retention of raw OCR in logs; encrypt at rest (B2 + Mongo).
- **Disclaimers**: UI copy that extracted numbers are **suggestions**; attorney/staff responsible for final figures.

---

## 6. Relationship to Current Document Processing

| Concern              | Current (RAG)              | New (intake)                    |
|----------------------|----------------------------|----------------------------------|
| Text extraction      | `pdf-parse`                | + OCR / vendor, per-type parsers |
| Storage              | `document_chunks` + vectors| `document_extractions` JSON    |
| Consumer             | Admin Q&A                  | Affidavit workflows + review UI  |
| Can share            | Same B2 object, same `Document` row | Optional link `documentId`   |

Running **both** pipelines on the same upload is valid: one job for embeddings, one for structured extraction (or a single orchestrator that branches).

---

## 7. Open Decisions

- **Vendor choice** for OCR/tables (cost vs accuracy vs HIPAA-style requirements if applicable).
- **Single vs multi-employer**: multiple W-2s → multiple employment rows.
- **Conflict policy** when extracted values disagree with existing affidavit rows (overwrite vs merge vs flag-only).

---

## 8. Phase 1 implementation (server)

**Env**

- `DOCUMENT_INTAKE_ENABLED=true` — required for intake HTTP endpoints and processing.
- `DOCUMENT_INTAKE_ON_UPLOAD=true` — optional; runs intake pipeline after each successful PDF upload (same process as RAG `processDocument`).

**Collection:** `document_extractions` — see `server/src/models/document-extraction.model.ts`.

**HTTP (all under `/api`, auth required)**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/cases/:caseId/document-intake` | List extractions for the case (optional `?documentId=` → latest for one document). |
| GET | `/cases/:caseId/documents/:documentId/intake` | Latest extraction for a document. |
| POST | `/cases/:caseId/documents/:documentId/intake/analyze` | Start async intake job (`202`); poll GET intake. |
| POST | `/cases/:caseId/documents/:documentId/intake/reject` | Mark latest `pending_review` extraction as `rejected`. |

**Pipeline:** `server/src/lib/document-intake/pipeline.ts` — B2 fetch → `pdf-parse` → rule classification → v0 text handlers. Weak text sets `rawPayload.ocrNote` (OCR not in Phase 1).

**Tests:** `npm test` in `server/` runs handler/classifier unit tests.

---

## 9. References (in-repo)

- `server/src/lib/document-processing.ts` — current PDF text + chunk + embed path.
- `server/src/lib/document-intake/` — intake pipeline and handlers.
- `server/src/routes/affidavit-employment.routes.ts` — employment CRUD target.
- `Read Me/architecture-long-form-affidavit.md` — PDF field mapping from DB.
- `docs/DOCUMENTS_AI_ARCHITECTURE.md` — existing Documents/RAG design.
