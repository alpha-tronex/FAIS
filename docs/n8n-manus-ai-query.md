# n8n + Manus workflows for AI Query

This document describes how to use n8n and Manus together with the FAIS AI Query feature: dynamic RAG examples, context API, and document-based enrichment.

## Prerequisites

- FAIS server running with MongoDB; admin or AI Staff user for API calls.
- n8n instance (self-hosted or cloud) with HTTP Request and webhook nodes.
- Manus API key ([open.manus.ai](https://open.manus.ai/docs)); used in n8n to call Manus APIs.

## FAIS API endpoints

All endpoints require `Authorization: Bearer <JWT>` (admin or AI Staff role).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/ai-query/context` | Returns `{ schema, relationshipGraph }` for use in Manus task prompts. |
| GET | `/admin/ai-query/examples` | Lists dynamic RAG examples (from MongoDB). |
| POST | `/admin/ai-query/examples` | Add one or more RAG examples. Body: `{ question, query, result_summary }` or array of same. Each `query` is validated (find or aggregate); invalid ones are rejected. |
| POST | `/admin/query` | Run AI query. Body: `{ question, skipClarification?, documentContext? }`. `documentContext` can be `{ countyNames?: string[], caseNumbers?: string[], userIdentifiers?: string[] }` from an uploaded document extraction. |

Base URL: your FAIS server (e.g. `http://localhost:3001` or production URL).

## Auth for n8n

- Obtain a JWT for a user with Admin (5) or AI Staff (Petitioner Attorney 3 / Legal Assistant 6) role (e.g. login via `/auth/login` and use the returned token).
- In n8n, store the token in credentials (e.g. "Header Auth" with `Authorization: Bearer <token>`). For long-lived automation, use a dedicated service user and refresh the token as needed.

## Workflow 1: Scheduled RAG example generation (n8n + Manus)

**Goal:** Periodically generate new (question, query, result_summary) triples using Manus and add them to FAIS so the AI Query benefits from more examples.

**Steps in n8n:**

1. **Trigger:** Schedule (e.g. weekly) or manual.
2. **HTTP Request – GET context**  
   - URL: `{{ $env.FAIS_BASE_URL }}/admin/ai-query/context`  
   - Auth: Bearer token (FAIS admin/AI Staff JWT).  
   - Save response (e.g. `schema`, `relationshipGraph`).
3. **Manus – Create task**  
   - Use Manus API (e.g. HTTP Request to Manus) to create a task:
     - Attach or pass the schema and relationship graph from step 2.
     - Instruction (example):  
       "Given the attached schema and relationship graph for a family-law admin dashboard, generate exactly 20 triples. Each triple has: (1) a natural-language question an admin might ask, (2) a MongoDB query as JSON in the form used by query_mongodb: either { type: 'find', collection, filter, projection?, limit? } or { type: 'aggregate', collection, pipeline }. (3) A one-line result summary. Use only collections: case, users, appointments, monthlyincome, assets, employment, liabilities, and the lookup_* collections. Output a valid JSON array of objects: [{ question, query, result_summary }, ...]."
   - Wait for task completion (webhook or poll).
4. **Parse** the Manus task result (JSON array of triples).
5. **Loop** over each triple (or batch):
   - **HTTP Request – POST example**  
     - URL: `{{ $env.FAIS_BASE_URL }}/admin/ai-query/examples`  
     - Method: POST  
     - Auth: same Bearer token.  
     - Body: single object `{ question, query, result_summary }`.  
   - FAIS validates the query; invalid items return 400. Optionally collect errors and log.
6. **Result:** New valid examples are stored in MongoDB and the RAG cache is invalidated so the next AI Query uses them.

## Workflow 2: Document extraction and query with document context (n8n + Manus)

**Goal:** User (or system) uploads a file; Manus extracts counties, case numbers, and/or user identifiers; FAIS runs an AI query with that context.

**Steps in n8n:**

1. **Trigger:** Webhook (file upload) or watch folder / external storage.
2. **Manus – Upload file**  
   - Use Manus Files API to upload the file (Excel, PDF, etc.).
3. **Manus – Create task**  
   - Instruction (example):  
     "Extract from this document and return JSON: { countyNames: string[], caseNumbers: string[], userIdentifiers: string[] }. For county names use exact names (e.g. Broward, Miami-Dade). For case numbers use format like 2024-DR-001. For people use usernames or full names as they might appear in the system."
   - Wait for task completion.
4. **Parse** the extraction result.
5. **HTTP Request – POST query with document context**  
   - URL: `{{ $env.FAIS_BASE_URL }}/admin/query`  
   - Method: POST  
   - Auth: Bearer token.  
   - Body:  
     - `question`: e.g. "Summarize cases in these counties" or "List income for these users."  
     - `documentContext`: the extracted object (e.g. `{ countyNames: [...], caseNumbers: [...], userIdentifiers: [...] }`).
6. **Result:** FAIS enriches the question with the document context (resolves county names to IDs, user identifiers to userIds, and restricts to case numbers where applicable) and runs the AI query.

## Workflow 3: Batch failed-question improvement (optional)

**Goal:** Use failed or clarification questions (if you log them) to generate new RAG examples via Manus.

**Steps:**

1. **Trigger:** Schedule or webhook when you have a list of failed/clarification questions (e.g. from logs or an admin queue).
2. **GET** FAIS `/admin/ai-query/context` (same as Workflow 1).
3. **Loop** over each failed question:
   - **Manus – Create task** with schema + relationship graph + the question; instruction: "Generate the correct MongoDB query (find or aggregate) for this question. Output a single JSON object: { question, query, result_summary } with query in query_mongodb form."
   - On success, **POST** to `/admin/ai-query/examples` with the returned triple.
4. **Result:** New examples are added so similar questions are more likely to get a correct query next time.

## Manus API notes

- **Base URL / auth:** Use your Manus API key (e.g. in header or as per [Manus API docs](https://open.manus.ai/docs)).
- **Tasks:** Create with `POST /v1/tasks`; include instructions and optionally file IDs. Use webhooks or polling to get the result.
- **Files:** Upload with `POST /v1/files`; attach the returned file ID to a task if the task should use the file as context.

## Security

- Keep JWT and Manus API keys in n8n credentials; do not commit them.
- FAIS validates every candidate RAG example (allowed collections, no forbidden operators) before storing; only valid examples are added.
- Document context is resolved server-side (county names → IDs, user identifiers → userIds) and merged into the existing enrichment and filter logic.
