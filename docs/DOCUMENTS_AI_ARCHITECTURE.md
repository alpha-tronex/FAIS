# Documents / AI Document Analysis — Architecture & Plan

This document describes the **Documents** feature: upload PDFs to Backblaze B2, extract text, chunk, embed, store in MongoDB Atlas Vector Search, and answer questions via an LLM with citations.

---

## 1. Overview

```
Document Upload (PDF)
        ↓
Object Storage (Backblaze B2)
        ↓
Background job: Text Extraction → Chunking → Embeddings → Vector Store (MongoDB Atlas)
        ↓
Admin: Vector Search → LLM Q&A with citations
```

- **Ownership:** Documents are tied to a **case**. Only **petitioners** (roleTypeId 1) can upload; only **admins** (roleTypeId 5) can run the global Q&A.
- **Query scope:** **Global** — admin searches across all documents in the system.
- **Download:** Users with access to the document's case get a **presigned URL** (Option B) to download the original PDF from B2.
- **Deletion:** **Hard delete** — remove object from B2 and delete all chunks for that document; no orphan data.

---

## 2. Auth & Authorization

| Action           | Who can do it |
|-----------------|----------------|
| Upload document | Petitioner for that case (`case.petitionerId === auth.sub`) |
| List documents  | User with access to the case (petitioner, respondent, attorneys, admin) |
| Download        | User with access to the case |
| Retry processing| Petitioner for that case or admin |
| Delete document | Petitioner for that case or admin |
| Query (Q&A)     | Admin only |

Case access reuses the existing `canSeeCase`-style logic (petitioner, respondent, petitioner/respondent attorney, legal assistant, admin).

---

## 3. Data Model

### 3.1 `documents` (MongoDB collection)

| Field          | Type     | Description |
|----------------|----------|-------------|
| `_id`          | ObjectId | Document ID |
| `caseId`       | ObjectId | Ref `case` |
| `uploadedBy`   | ObjectId | User who uploaded |
| `originalName` | string   | Original filename |
| `b2Key`        | string   | B2 object key (e.g. `documents/{documentId}.pdf`) |
| `mimeType`     | string   | `application/pdf` |
| `size`         | number   | File size in bytes |
| `status`       | string   | `uploaded` \| `processing` \| `ready` \| `failed` |
| `errorMessage` | string?  | Set when `status === 'failed'` (for UI + Retry) |
| `createdAt`    | Date     | |
| `updatedAt`    | Date     | |

Indexes: `caseId`, `status`, `uploadedBy`.

### 3.2 `document_chunks` (MongoDB collection)

| Field         | Type     | Description |
|---------------|----------|-------------|
| `_id`         | ObjectId | |
| `documentId`  | ObjectId | Ref `documents` |
| `chunkIndex`  | number   | Order of chunk in document |
| `text`        | string   | Chunk content |
| `embedding`   | number[] | Vector (e.g. 1536 for text-embedding-3-small) |
| `page`        | number?  | Page number if available from extractor |
| `documentName`| string   | Denormalized for citations |

**Atlas Vector Search index:** on `embedding` (cosine similarity, dimension 1536).

---

## 4. B2 (Backblaze) Configuration

- **Env vars** (in `server/.env`, never committed):
  - `B2_KEY_ID` — Application Key ID
  - `B2_APP_KEY` — Application Key (secret)
  - `B2_BUCKET_NAME` — Bucket name
  - `B2_ENDPOINT` — S3-compatible endpoint (e.g. `s3.us-west-004.backblazeb2.com`)

- **Key format:** `documents/{documentId}.pdf` (unique per document; easy delete).

- **Operations:** upload buffer, get object (for processing), delete object, presigned GET URL for download.

---

## 5. API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST   | `/api/cases/:caseId/documents` | Petitioner for case | Upload PDF (multipart); validate PDF + size; save to B2 + DB; trigger processing |
| GET    | `/api/cases/:caseId/documents` | Can see case | List documents for case |
| GET    | `/api/cases/:caseId/documents/:documentId/download` | Can see case | Return `{ url }` presigned GET URL |
| POST   | `/api/cases/:caseId/documents/:documentId/retry` | Petitioner or admin | Set status to `uploaded`, trigger processing |
| DELETE | `/api/cases/:caseId/documents/:documentId` | Petitioner or admin | Delete from B2, delete chunks, delete document |
| POST   | `/api/documents/query` | Admin | Body `{ question }` → vector search → LLM → `{ answer, sources }` |

---

## 6. Validation (v1)

- **Type:** PDF only; validate by **magic bytes** (`%PDF-` at start of buffer).
- **Max size:** e.g. 10 MB (configurable).
- Reject with 400 and clear message if invalid.

---

## 7. Background Processing

After a successful upload:

1. Set `status = 'processing'`, clear `errorMessage`.
2. Fetch file from B2.
3. **Extract text:** e.g. `pdf-parse`; on failure set `status = 'failed'`, `errorMessage = 'Could not extract text from PDF'`.
4. **Chunk:** e.g. LangChain `RecursiveCharacterTextSplitter` (chunkSize ~1000, overlap ~200); attach `documentId`, `chunkIndex`, `page` (if available).
5. **Embed:** Same model as AI Query (`text-embedding-3-small`); batch embed chunk texts.
6. **Store:** Insert into `document_chunks` with `documentName` from document.
7. Set `status = 'ready'`, clear `errorMessage`.
8. On any exception: set `status = 'failed'`, `errorMessage = err.message` (or sanitized).

**Trigger:** Fire-and-forget after upload, or cron that picks `status === 'uploaded'`. Retry button sets `status = 'uploaded'` and re-triggers the same flow.

---

## 8. Query Flow (Admin Only, Global)

1. Embed the question (same embedding model).
2. **Atlas Vector Search** on `document_chunks` with question vector; limit top-k (e.g. 5–10); return `text`, `documentName`, `page`.
3. Build prompt: "Answer based only on these excerpts; cite source as document name and page if given" + excerpts + question.
4. Call LLM; return `{ answer, sources }` where `sources` is e.g. `[{ documentName, page? }]` for citations ("Source: filename.pdf (page 3)").

---

## 9. UI Placement

- **Top-level "Documents" / "AI Document analysis"** page (tile already on home; enable route e.g. `/documents`).
- **List:** Case selector (petitioner: their cases; admin: all) → list documents for selected case with status, error message, Retry, Download, Delete.
- **Upload:** Petitioner only; for selected case.
- **Admin:** "Ask a question" box → call `/api/documents/query` → show answer and sources.

---

## 10. Implementation Order

1. Env + B2 client (upload, get, delete, presigned URL).
2. `documents` + `document_chunks` models; upload API (validation, petitioner auth).
3. Processing (pdf-parse → chunk → embed → write chunks); trigger after upload; retry support.
4. Atlas vector index on `document_chunks`; query API (admin, global, with sources).
5. Download (presigned) + delete (B2 + chunks + document).
6. Frontend: Documents page (list, upload, download, retry, delete, admin query + citations); routing; enable home tile.

---

## 11. Security & Ops

- B2 keys only in server env; never in client or repo.
- Rotate keys if ever exposed.
- Citations: simple "Source: document name (and page if available)" from stored metadata.

---

## 12. MongoDB Atlas Vector Search Index

For document Q&A, the code uses Atlas Vector Search on the `document_chunks` collection. If the index is missing, the server falls back to in-memory cosine similarity (fine for small datasets).

To create the index in **Atlas** (Database → Collections → document_chunks → Search Indexes → Create Index):

- **Index name:** `vector_index`
- **Type:** Vector Search
- **Field:** `embedding` (vector, dimension **1536** for `text-embedding-3-small`)
- **Similarity:** cosine

Example index definition (JSON):

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    }
  ]
}
```
