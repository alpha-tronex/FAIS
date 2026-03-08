# AI Query: RAG Architecture Design

This doc explains why the current AI Query feature has been hard to optimize, and how **Retrieval Augmented Generation (RAG)** can fix that.

---

## Architecture overview (target)

The target architecture for the AI Query feature is:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Off the hot path (startup / scheduled)                                 │
│  • Schema discovery agent → cached schema (collections, fields, samples)  │
│  • Relationship graph (static or from discovery) → in-memory / config    │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
Angular (UI)
     |
     v
Node / Express API (orchestrator)
     |
     |---- MongoDB (Affidavit data, cases, users, etc.)
     |
     |---- Vector Search (Embeddings + example store)
     |
     |---- Schema cache + Relationship graph + ID enrichment
     |
     |---- LangChain / AI Orchestrator
     |
     v
OpenAI LLM
     |
     v
AI Response
```

### Request flow (8 steps)

The API handles each user question in this order:

1. **User question** — User submits a natural-language question (e.g. from the Admin Query page).
2. **Check ambiguity** — LLM (or a dedicated step) determines whether the question is clear or ambiguous. If **ambiguous** or missing key information → return a **clarification request**; do **not** generate a query. If **clear** → continue.
3. **ID enrichment** — Parse the question for entity mentions (county names, state names, user names). Resolve them to DB IDs (e.g. “Broward” → countyId, “John Smith” → userId) and build an enrichment context. This context is injected into the prompt so the LLM uses the correct IDs instead of guessing.
4. **Retrieve RAG examples** — Embed the question and run vector search over the example store; get top‑k `(question, query, result_summary)` triples to augment the prompt.
5. **Generate Mongo query** — LLM produces a structured `query_mongodb` call (find or aggregate) using: **cached schema** + **relationship graph text** + RAG examples + **enrichment context**. Optionally substitute placeholders in the tool args with resolved IDs before validation.
6. **Validate query** — Server validates collection, filter/pipeline, and allowed stages (optionally using the relationship graph for $lookup checks); reject if invalid.
7. **Run query** — Execute the query against MongoDB; fetch results (and optionally resolve users, appointments, assets as today).
8. **Optional LLM summary** — If the result set is large, call the summary LLM; otherwise return raw results.

- **Angular (UI):** Admin Query page; user submits a natural-language question.
- **Node / Express API:** Orchestrates the 8-step flow: ambiguity check → (if clear) **ID enrichment** → RAG retrieval → query generation (using schema + relationship graph + RAG + enrichment) → validation → execution → optional summary; returns either a clarification question or summary/raw results.
- **MongoDB:** Source of truth for affidavit data, cases, users, lookups; queries are validated and read-only. Supports both **find** and **aggregate** (see §5).
- **Schema discovery (off-path):** Runs at startup or on a schedule. Introspects allowed collections (field names, sample types) and builds a **cached schema** used in the prompt so the LLM sees accurate, up-to-date structure and avoids hallucinated fields.
- **Relationship graph (off-path):** Static or derived map of how collections link (e.g. case.petitionerId → users._id, case.countyId → lookup_counties). Formatted as text and included in the prompt so the LLM (and optionally validation) gets $lookup paths right.
- **ID enrichment (per-request):** After the question is deemed clear, parses the question for county names, state names, and user names; resolves them to DB IDs via lookups; injects “Resolved: Broward → countyId 2” (etc.) into the prompt so the LLM uses correct IDs.
- **Vector Search:** LangChain + **MongoDB Atlas Vector Search** (or in-memory similarity over examples); stores embeddings of example (question, query, result_summary) triples; used in step 4 after enrichment.
- **LangChain / AI Orchestrator:** Embeddings, vector store, and the flow that runs ambiguity check, ID enrichment, builds the prompt from schema + relationship graph + retrieved examples + enrichment, and calls the LLM for query generation and (when needed) summary.
- **OpenAI LLM:** (1) **Clarification** — decide if the question is ambiguous; if so, return a short clarification question. (2) **Query generation** — (if clear) produce the structured MongoDB query using the enriched context. (3) **Summarize only if needed** — if the result set is large, summarize; otherwise the API returns raw results.
- **AI Response:** Either a **clarification request** (e.g. “Do you mean Miami-Dade county?”) or **summary** and/or **raw result set**.

---

## 1. Current approach (and why it’s the “wrong” optimization)

Today the flow is:

1. **One big schema prompt** — The full `MONGO_QUERY_SCHEMA_DESCRIPTION` (all collections, all fields, many “CRITICAL” rules) is sent to the LLM every time.
2. **LLM → single MongoDB query** — The model is forced to output one structured `query_mongodb` call; we validate and run it.
3. **Special-case bypasses** — When the model kept failing on certain intents, we added **bypasses** that skip the LLM entirely:
   - “Petitioners/respondents in [county]” → we run a case query by `countyId` ourselves.
   - “Cases involving [username]” → we resolve the user and run the case query ourselves.
   - “Employment/income/assets/affidavit for [username]” → we run affidavit collections ourselves.

So “optimization” has meant: **more schema text + more rules + more bypasses**. That scales poorly: every new intent risks new edge cases and more prompt/schema bloat.

---

## 2. What RAG changes

**RAG = Retrieve → Augment → Generate**

- **Retrieve:** Given the user question, fetch *relevant* context (e.g. similar past questions + their correct queries, or only the schema bits that apply).
- **Augment:** Put that context into the prompt instead of the entire schema and all rules.
- **Generate:** The LLM produces the query (and/or answer) using that focused context.

Benefits for AI Query:

| Current | With RAG |
|--------|----------|
| Entire schema + all CRITICAL rules every time | Only **relevant** examples and/or schema chunks for this question |
| New intents = more bypass code + more schema rules | New intents = add **example (question, query, result_summary)** triples; retrieval finds them when similar questions are asked |
| Model must infer from a long, generic description | Model sees **concrete examples** of “this kind of question → this query” |
| Hard to scale to new collections or question types | Scale by curating examples and (optionally) schema chunks; fewer special-case branches |

So yes — **you can benefit from RAG** for this feature. It addresses the right levers: **what context we give the model**, instead of adding more bypass logic.

---

## 3. Recommended RAG design for AI Query

### 3.0 Clarification flow: check ambiguity before query generation

**Do not generate a query when the question is ambiguous or missing key information.** Instead, return a **clarification request** so the user can disambiguate.

**Flow:**

- **User question** → LLM (or a dedicated classifier) determines if the question is **clear** or **ambiguous**.
- **If ambiguous** → Return a short clarification question to the user. Do **not** call RAG retrieval or generate a MongoDB query.
- **If clear** → Proceed to step 3 (retrieve RAG examples), then generate query, validate, run, and optionally summarize.

If the user’s request could refer to **multiple records or locations**, ask a clarification question instead of generating a query.

**Examples of ambiguity:**

- **Location names** — e.g. “Miami” could mean the city or Miami-Dade County.
- **Common person names** — e.g. “John Smith” when multiple users match.
- **Missing time ranges** — e.g. “show appointments” without a date or “upcoming.”

**Example exchanges:**

| User | Assistant (clarification) |
|------|----------------------------|
| Show cases in Miami | Do you mean Miami-Dade county? |
| Show affidavit for John Smith | Which John Smith? Multiple records exist. |

Implementation options: (a) a dedicated LLM call that returns either `{ "clear": true }` or `{ "clear": false, "clarification": "…" }`, or (b) a single LLM call with two possible tools: `request_clarification` and `query_mongodb`, so the model can either ask for clarification or output a query. In both cases, the API only runs steps 3–7 when the question is determined to be clear.

### 3.1 Example-based retrieval (main lever)

- **Store:** Triples of `(question, query, result_summary)` where:
  - `query` is the validated MongoDB query (find or aggregate; see §7).
  - `result_summary` is a short example of how results for that question were explained (e.g. “Broward County has the highest average income at $78,200.”).
- Storing **result_summary** lets retrieval show the LLM not only how to **query**, but how to **explain** results — so it learns both query patterns and summary style.
- **At runtime:**  
  1. Embed the user’s question (e.g. with OpenAI `text-embedding-3-small`).  
  2. Retrieve the top‑k most similar **stored examples** (by vector similarity).  
  3. Add to the prompt: “Here are similar questions, the exact query used for each, and an example result summary: …” plus the **retrieved (question, query, result_summary)** triples.  
  4. Ask the model to output a single `query_mongodb` call for the **current** question, following the style of the examples.
- **Schema:** Keep a **short** schema (list of allowed collections + one-line descriptions) in the system prompt; optionally add retrieved schema chunks (see below). The heavy lifting is done by examples.

This gives you **few-shot query generation and summarization** driven by similarity: e.g. “petitioners in Miami-Dade” can retrieve examples like “petitioners in Broward” and reuse both the query pattern (case + `countyId`) and the style of the result summary.

### 3.2 Optional: schema chunk retrieval

- **Store:** Chunks of the schema (e.g. one chunk per collection, or per “intent” like “county → case” vs “username → affidavit”).
- **At runtime:** Optionally retrieve the top schema chunks for the question (by embedding the question and each chunk) and add only those to the prompt.
- Use this to **reduce prompt size** and **focus** the model on the right collections/fields when you have a large schema.

### 3.3 Conditional summarization (reduce cost and latency)

Instead of always calling a second LLM to summarize:

- **LLM #1** → generate Mongo query (unchanged).
- **MongoDB** → run query (find or aggregate).
- **LLM #2** → **summarize only if needed.**

Rules:

- **If result set is small** (e.g. below a threshold such as 5–10 rows or 2KB): return **raw results** to the user. No summary LLM call — users can read the data directly. Saves tokens and latency.
- **If result set is large:** call the summary LLM to produce a concise natural-language answer.

Otherwise you spend tokens summarizing content users could read directly.

### 3.4 What stays the same (safety)

- **Structured output:** Keep using the `query_mongodb` tool and **do not** let the model output raw MongoDB or arbitrary code.
- **Validation:** Keep validation and allowlist of collections and (for aggregate) allowed pipeline stages; RAG only changes **how we build the prompt**, not execution safety.
- **Bypasses:** You can **keep** the existing bypasses as a fast path (e.g. county / cases-involving-user / affidavit-for-user). RAG then handles the long tail with fewer new bypasses over time.

---

## 4. LangChain + MongoDB Atlas Vector Search (vector store)

The design uses **vector search** over stored examples. The recommended stack is **LangChain + MongoDB Atlas Vector Search** only (no in-memory or other vector DBs).

- **Embeddings:** LangChain’s `OpenAIEmbeddings` (e.g. `text-embedding-3-small`) wired to your API key.
- **Vector store:** **MongoDB Atlas Vector Search** via LangChain’s MongoDB vector store integration. Store example documents with an embedding field and create a vector index; at request time, `similaritySearch(question, k)` runs against that index.
- **Indexed content:** Each example is a document with `question`, `query` (the tool payload), `result_summary` (example explanation), and the embedded `question` (or a dedicated `embedding` field) for similarity search.

**Flow:** Load `(question, query, result_summary)` triples into MongoDB; embed each `question` and store the vector in the same DB. At request time, embed the user question, run vector search in Atlas, retrieve top‑k examples, and augment the prompt. No change to validation or execution — only retrieval uses LangChain + MongoDB Atlas Vector Search.

---

## 5. Extended query tool: find and aggregate

Extend the tool schema so the LLM can request either a **find** or an **aggregation**.

### 5.1 Two query types

**Option A — Simple find**

```json
{
  "type": "find",
  "collection": "case",
  "filter": {},
  "projection": {},
  "limit": 100
}
```

**Option B — Aggregation**

```json
{
  "type": "aggregate",
  "collection": "monthlyincome",
  "pipeline": [
    { "$match": { "userId": { "$exists": true } } },
    { "$group": { "_id": null, "averageIncome": { "$avg": "$amount" } } }
  ]
}
```

The server runs:

- **find:** `db.collection(name).find(filter).project(projection).limit(limit)`
- **aggregate:** `db.collection(name).aggregate(pipeline)`

### 5.2 Allowed aggregation stages

Restrict the pipeline to safe stages only:

```js
const allowedStages = [
  "$match",
  "$group",
  "$sort",
  "$limit",
  "$project",
  "$count"
];
```

Validate that each stage in `pipeline` has exactly one key and that key is in `allowedStages`. Reject otherwise.

### 5.3 Example: average income

**User question:** What is the average income of affidavit clients?

**AI tool output:**

```json
{
  "type": "aggregate",
  "collection": "monthlyincome",
  "pipeline": [
    { "$group": { "_id": null, "averageIncome": { "$avg": "$amount" } } }
  ]
}
```

Server runs `db.collection("monthlyincome").aggregate(pipeline)` and returns the result; if the result set is small, return raw; if large or a single aggregate result, optionally summarize.

### 5.4 Example: counties by highest average income (full flow)

**User question:** Which counties have the highest average income?

**LLM generates:**

```json
{
  "type": "aggregate",
  "collection": "monthlyincome",
  "pipeline": [
    { "$group": { "_id": "$countyId", "avgIncome": { "$avg": "$amount" } } },
    { "$sort": { "avgIncome": -1 } }
  ]
}
```

*(If your schema stores county at the case or user level, the pipeline may need a preceding `$lookup` to attach countyId to income docs; adapt to your collections.)*

**MongoDB returns** (after resolving county ids to names, if done in app or via `$lookup`):

| _id (county) | avgIncome |
|--------------|-----------|
| Broward      | 78200     |
| Miami-Dade   | 71500     |
| Palm Beach   | 69000     |

**LLM summary (when summarization is invoked):** “Broward County has the highest average income among affidavit clients at $78,200.”

---

## 6. Implementation outline

Implement the **8-step request flow** (see Architecture overview):

1. **User question** — Accept natural-language input from the UI.
2. **Check ambiguity** — Call LLM (or use a tool choice) to decide if the question is clear. If ambiguous → return a clarification message (e.g. “Do you mean Miami-Dade county?”); **do not** run RAG or generate a query. If clear → continue.
3. **ID enrichment** — Call the ID enrichment layer: detect county/state/user names in the question; resolve to IDs; build enrichment context and prompt snippet; inject into the prompt for step 5.
4. **Retrieve RAG examples** — Use LangChain’s `OpenAIEmbeddings` and **MongoDB Atlas Vector Search**; embed the question and get top‑k `(question, query, result_summary)` triples; add them to the prompt.
5. **Generate Mongo query** — Build system content from **cached schema** + **relationship graph text** + RAG examples + **enrichment snippet**. LLM outputs a single `query_mongodb` call (find or aggregate). Optionally substitute placeholders in tool args with resolved IDs.
6. **Validate query** — Validate collection (allowlist), and for aggregate validate pipeline stages; optionally validate $lookup against the relationship graph. Reject if invalid.
7. **Run query** — Execute via `find()` or `aggregate()`; optionally resolve users, appointments, assets.
8. **Optional LLM summary** — If result set is large → call summary LLM; otherwise return raw results.

**Additional:** Curate example triples for key intents. Run schema discovery at server startup (or on first request) to populate the cached schema. Keep the relationship graph as static config.

---

## 7. Accuracy enhancements: schema discovery, relationship graph, ID enrichment

Three components improve LLM accuracy without changing the safety model (structured tool + validation).

### 7.1 Schema discovery agent

- **Purpose:** Keep the schema text the LLM sees in sync with the real DB. Reduces wrong or hallucinated field names.
- **When:** Off the hot path — at server startup or on a schedule (or lazy on first request).
- **What:** For each allowed collection, introspect (e.g. field names from sample docs, optional distinct values for key fields). Build a short schema description and **cache it** (in-memory).
- **At request time:** The orchestrator uses this **cached schema** in the system prompt. Fallback: use static `MONGO_QUERY_SCHEMA_SHORT` if discovery has not run or fails.

### 7.2 Relationship graph

- **Purpose:** Explicit map of how collections link (e.g. case.petitionerId → users._id, case.countyId → lookup_counties). Improves correct $lookup and multi-hop queries.
- **When:** Static or derived once; used at request time as prompt text and optionally in validation.
- **What:** Define edges (fromCollection, fromField, toCollection, toField). Format as short text and append to the system prompt. Optionally validate $lookup stages against the graph.

### 7.3 ID enrichment layer

- **Purpose:** Resolve entity mentions (e.g. "Broward", "John Smith") to DB IDs and inject them into the prompt so the LLM does not guess IDs.
- **When:** Per request, after ambiguity check (step 2), before RAG (step 4).
- **What:** Parse the question for county names, state names, user names; resolve via lookup_counties, lookup_states, users; build enrichment context and prompt snippet (e.g. "Resolved: Broward → countyId 2"); append to system or user message. Optionally substitute placeholders in the generated query before validation.

---

## 8. Summary

- **Current optimization** = bigger schema + more bypass code → fragile and hard to scale.
- **Request flow (8 steps):** User question → **Check ambiguity** (if ambiguous, return clarification; do not generate a query) → ID enrichment → Retrieve RAG examples → Generate Mongo query (schema + relationship graph + RAG + enrichment) → Validate query → Run query → Optional LLM summary.
- **Clarification:** If the question is ambiguous (e.g. location names, common person names, missing time ranges) or could refer to multiple records, return a clarification request (e.g. “Do you mean Miami-Dade county?” / “Which John Smith?”) instead of generating a query.
- **RAG** = **vector search** over example triples `(question, query, result_summary)` so the LLM sees both query patterns and how to explain results. Same safety (structured tool + validation), better scaling and maintainability.
- **Schema + graph + enrichment:** Use cached schema (from discovery), relationship graph text, and ID enrichment snippet in the prompt to improve accuracy.
- **Stack:** **LangChain + MongoDB Atlas Vector Search** (or in-memory) for RAG — embeddings and example store in Atlas; run vector search (step 3) only after the question is deemed clear.
- **Conditional summarization:** Summarize only if result set is large; otherwise return raw results to save cost and latency.
- **Query tool:** Extend to **find** and **aggregate**; allow only stages `$match`, `$group`, `$sort`, `$limit`, `$project`, `$count`. Validate and execute server-side.
- **Next step:** Implement ambiguity check (step 2), then add example triples, indexing and retrieval, find/aggregate tool, and conditional summarization. Keep bypasses and validation; add more examples over time.
