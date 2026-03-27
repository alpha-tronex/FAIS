# Milestones: Document Intake → Affidavit Prefill

Realistic phased plan for a small team. Durations are **indicative** (calendar weeks); adjust for headcount and compliance review.

---

## v1 document scope (locked)

| Document type | Typical affidavit target | Notes |
|---------------|---------------------------|--------|
| **W-2** | Employment | Employer name, Box 1 wages; occupation / pay frequency may need manual input or future pay-stub support. |
| **Mortgage statement** | Liabilities (principal / balance); optional household expense if PITI is split in product rules | Decide single liability row vs expense row (or both). |
| **Electricity monthly bill** | Monthly household expense | Normalize statement period to a monthly amount; document “last bill” vs average policy. |
| **Mastercard monthly statement** | Liabilities | Map **statement / new balance**, not transaction totals; issuer layouts vary—plan multiple templates or robust table extraction. |

**Classification labels (v1):** `w2`, `mortgage_statement`, `utility_electric`, `credit_card_mastercard` (or `credit_card` if the handler generalizes beyond Mastercard branding).

---

## Phase 0 — Foundations (2–3 weeks)

**Outcome:** Agreed scope, vendor shortlist, and technical spike.

- [x] Lock **v1 document types** (see table above: W-2, mortgage statement, electricity bill, Mastercard statement).
- [ ] Collect **sample PDFs** for each v1 type (3–5 per type: digital text, clean scan, poor scan); aim for **15–20+** files total, including multiple Mastercard issuer templates if possible.
- [ ] Spike: **text vs scan** detection on the sample set.
- [ ] Spike: one **managed OCR/API** (e.g. Textract or Document AI) vs Tesseract on same samples; record accuracy and cost.
- [ ] Define **JSON schema** per v1 type (envelope + `confidence` per field): employment-oriented fields for W-2; liability fields for mortgage and Mastercard; expense fields for electricity.
- [ ] Security/privacy pass: retention, who can see extractions, logging redaction.

**Exit criteria:** Written decision on primary OCR/extraction path for v1; schemas reviewed; sample corpus labeled.

---

## Phase 1 — Backend skeleton (3–5 weeks)

**Outcome:** Async pipeline persists proposals for **all v1 document types**; no full UI yet.

**Status (implemented in repo):** Model, rule-based classification, pdf-parse text path, v0 handlers, REST endpoints, optional upload hook, `npm test` for handlers. **Not yet:** rasterize/OCR (weak text is flagged via `rawPayload.ocrNote` only).

- [x] New model(s): `document_extractions` (or equivalent) with `pending_review` / `failed` states.
- [x] Job worker: enqueue on upload **or** manual “Analyze document” action (safer for cost control).
- [x] Implement **classification** (rules + fallback) for the four v1 labels.
- [ ] Implement **routing**: text path → parse; weak text → rasterize + OCR/vendor. *(Phase 1: text path only + weak-text note.)*
- [x] Handler **v0** (structured JSON + confidences): **W-2** (employment); **mortgage statement** (liability + optional payment fields); **electricity bill** (utility expense); **Mastercard statement** (liability — statement balance).
- [x] **API:** `GET` extractions by case/document; `POST` reject; no apply yet.
- [x] Unit tests on mappers with fixture JSON **per v1 type**.

**Exit criteria:** Upload triggers job; Mongo contains structured `pending_review` proposals for **known-good sample PDFs covering each v1 type** (can land handlers incrementally, but all four before phase exit).

**How to try:** Set `DOCUMENT_INTAKE_ENABLED=true` (and B2 + Mongo as usual). `POST /api/cases/:caseId/documents/:documentId/intake/analyze`, then poll `GET .../documents/:documentId/intake`. Optional: `DOCUMENT_INTAKE_ON_UPLOAD=true` to run intake after each upload.

---

## Phase 2 — Review and apply (4–6 weeks)

**Outcome:** Staff can approve and write to real affidavit data for **employment, liabilities, and monthly household expenses** as extracted from v1 documents.

- [ ] **Apply** path: transactional writes via existing affidavit services — **employment** (W-2), **liabilities** (mortgage, Mastercard), **monthly household expense** (electricity), per product rules.
- [ ] **Conflict rules:** e.g. append vs merge when employer or creditor name matches; overwrite policy for same utility type.
- [ ] **Audit:** log source `documentId`, extraction version, user who applied.
- [ ] **Client (minimal):** list pending proposals on case or affidavit edit; table of fields; Apply / Discard.
- [ ] E2E tests: upload → review → apply for **each v1 type** (or critical subset + spot-checks).

**Exit criteria:** Pilot-ready for internal dogfood across **all four v1 document → section** paths.

---

## Phase 3 — Depth beyond v1 baselines (4–8 weeks, can parallelize)

**Outcome:** Higher accuracy and coverage **within** v1 families, plus clearer UX—without necessarily adding new document categories.

- [ ] **Issuer / vendor templates:** additional Mastercard bank layouts; second electric utility format; regional mortgage servicer variants.
- [ ] **Mortgage:** optional automatic split to **household expense** (PITI) if Phase 2 shipped liability-only.
- [ ] **Mapping config:** `typeId` rules for electricity (and other utilities later) in config, not hard-coded.
- [ ] Per-type **confidence thresholds** and review copy in UI; failure messages when classification is ambiguous.

**Exit criteria:** Production-ready accuracy on **real firm-provided samples** for all four v1 types; feature flag rollout criteria met.

---

## Phase 4 — Hardening and scale (ongoing, 2–4 weeks per slice)

- [ ] **Monitoring:** job failure rates, latency, vendor quota alerts.
- [ ] **Cost caps** per firm/case/month; disable auto-processing for oversized PDFs.
- [ ] **Retry** and dead-letter for poison documents.
- [ ] **Documentation** for firms: supported documents, limitations, review policy.
- [ ] Optional: **second pipeline** coexistence with vector RAG (same file, two jobs) documented in ops runbook.

**Exit criteria:** SLOs defined (e.g. 95% jobs complete &lt; 2 min); runbook for on-call.

---

## Cross-cutting (throughout)

- Feature flag: `documentIntakeAffidavit` (or per-type flags).
- Legal/compliance review before marketing **splash** claims as “automatic” filing (position as **suggestions** + review).
- Pilot with 1–2 firms: measure **time to complete employment, liabilities, and relevant expense lines** before/after.

---

## Summary timeline (rough)

| Phase | Weeks (cumulative) |
|-------|--------------------|
| 0     | 2–3                |
| 1     | +3–5               |
| 2     | +4–6               |
| 3     | +4–8               |
| 4     | parallel / iterative |

**Total to first production slice (all four v1 types + review + apply):** ~**11–16 weeks** for a focused team, assuming no major compliance blockers (wider than employment-only because of liabilities and expense mapping).
