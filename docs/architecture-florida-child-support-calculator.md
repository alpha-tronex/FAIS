# Architecture: Florida Child Support Guidelines Calculator

This document describes how to add **statutory guideline math** (Florida Family Law Rules of Procedure **Form 12.902(e)** and **§ 61.30, Florida Statutes**) on top of FAIS’s existing **child support worksheet** workflow: today the app stores worksheet inputs and fills the official PDF, but **does not compute** basic obligation, shares, time-sharing gross-up, or presumptive transfer amounts.

Implementation can proceed in phases; this file is the blueprint.

---

## 1. Goals

- **Compute worksheet line items** consistent with Form 12.902(e) (06/25) instructions: combined net income → chart obligation → percentages → shares → add-ons → credits → (optional) substantial time-sharing block → presumptive amount.
- **Pre-fill calculated fields** on `fl-child-support-guidelines-worksheet.pdf` in addition to the raw inputs already mapped in `child-support-worksheet-pdf.ts`.
- **Expose computed values** on `GET /api/child-support-worksheet/summary` (or a dedicated endpoint) so the UI can show totals without opening the PDF.
- **Stay in sync with the official chart** embedded in the worksheet instructions PDF (or regenerate from statute when forms update).

Non-goals for an initial release:

- **Deviation motions** (Form 12.943) or judicial discretion above/below guidelines.
- **Guaranteeing parity** with every version of clerk e-filing validators or third-party calculators; goal is **faithful implementation of the published worksheet algorithm** with tests on anchor cases.
- **Replacing** legal advice or local procedural rules.

---

## 2. Current State (FAIS)

| Area | Behavior today |
|------|----------------|
| Data | `childsupportworksheet` collection; `WorksheetData` in `child-support-worksheet-store.ts` (children counts, parent A/B gross-style income, overnights, daycare/health/other dollar fields, etc.). |
| PDF | `fillChildSupportWorksheetPdf` loads the official template, matches AcroForm names by needle, **`form.flatten()`** on save. **No guideline calculations** in TypeScript. |
| Affidavit | `computeAffidavitSummary` exposes **gross** monthly income from `monthlyincome`; deductions live in `monthlydeductions` but are **not** used for worksheet net income today. |

---

## 3. Legal / Form References

- **Form**: Child Support Guidelines Worksheet, **12.902(e)** — template in `server/private/forms/fl-child-support-guidelines-worksheet.pdf`.
- **Statute**: **§ 61.30** — income definition, schedule, time-sharing, add-on expenses, and treatment of amounts **above** the printed chart.
- **Chart source of truth**: The **Child Support Guidelines Chart** printed in the form instructions (same PDF). If combined income is not on the chart, the form points to **§ 61.30(6)** for calculation; the implementation should define extrapolation/interpolation rules explicitly (see §6).

---

## 4. Proposed Module Layout

All paths under `server/src/lib/` unless noted.

```
florida-child-support/
  chart-data.gen.ts          # Generated constant: bracket rows $800–$10,000 × 6 child columns
  chart-generate.script.ts   # Optional: one-off script reading pdf-parse output from the template PDF
  lookup-basic-obligation.ts # Interpolation within chart; extrapolation above top bracket
  compute-worksheet.ts       # Pure function: inputs → all line items + flags
  compute-worksheet.test.ts  # node:test anchors (e.g. $2,000 combined, 1 child → $442 base)
pdf/
  child-support-form-fills.ts # Per-field mapping: computation result → AcroForm field names
  multi-widget-text.ts       # See §7 — petitioner vs respondent cells sharing one Acro name
```

Keep **pure math** separate from PDF I/O so tests do not require `pdf-lib`.

---

## 5. Data Model & Inputs

### 5.1 Income

Form **line 1** uses **present net monthly income** (affidavit Section I, **line 27** on Forms 12.902(b)/(c)).

Recommended approach:

- **`netMonthlyPetitioner`**, **`netMonthlyRespondent`**: prefer values **derived** from each party’s affidavit: sum(`monthlyincome`) − sum(`monthlydeductions`), clamped at ≥ 0, when case has both `petitionerId` and `respondentId`.
- **Overrides**: when the user has saved explicit worksheet numbers, continue to allow `parentAMonthlyGrossIncome` / `parentBMonthlyGrossIncome` (or rename/clarify in API as “monthly amount for worksheet column A/B”) — document whether these are **gross or net** in UI to avoid silent mismatch with the form’s “net” line 1.

If only one party’s affidavit exists, the other net income defaults to **0** unless manually entered (mirror current “one-sided” behavior with clear labeling).

### 5.2 Children

- `numberOfChildren` maps to chart column **1–6**. If `numberOfChildren > 6`, either clamp with a warning or refuse calculation until the form supports it.

### 5.3 Expenses (lines 5 / 14)

- **Child care**, **children’s health insurance**, **noncovered medical/dental/prescription** (monthly totals as already modeled: `daycareMonthly`, `healthInsuranceMonthly`, `otherChildCareMonthly` or split fields if you add them later).

### 5.4 Credits (lines 7 / 16–17)

- **Actually paid** child care, health, and noncovered amounts per party (not in current `WorksheetData` v1). Architecture should add optional fields, e.g. `creditChildCarePetitioner`, …, defaulting to **0**.

### 5.5 Time-sharing

- **Substantial time-sharing block (lines 10–21)** runs only when **each** parent has **≥ 73 overnights** (20% of 365), per form instructions.
- Use `overnightsParentA` / `overnightsParentB` with **Parent A = Petitioner**, **Parent B = Respondent** (consistent with existing PDF fill assumptions).

---

## 6. Algorithm Checklist (mirror the form)

**Shared primitives**

1. **Line 1**: Petitioner net, Respondent net, **Total** = sum.
2. **Line 2**: **Basic monthly obligation** = `lookupBasicMonthlyObligation(totalLine1, numberOfChildren)` from the statutory chart.
3. **Line 3**: Percent financial responsibility = each net ÷ total (handle **total = 0** — define behavior: no split, or block calculation).
4. **Line 4**: Share of basic obligation = line 2 × line 3 percentages.
5. **Line 5d** = 5a + 5b + 5c (totals).
6. **Line 6** = line 5d × line 3 percentages.
7. **Line 8** = 7a + 7b + 7c (per party column).
8. **Line 9** = line 4 + line 6 − line 8 (minimum obligation per parent before gross-up path).

**If substantial time-sharing**:

9. **Line 10** = line 2 × **1.5**.
10. **Line 11** = line 10 × line 3 percentages.
11. **Line 12** = (overnights ÷ 365) × 100 for each parent (define rounding: match form examples, e.g. reasonable decimals).
12. **Line 13A** = line 11A × line 12B; **Line 13B** = line 11B × line 12A.
13. **Lines 14–18**: repeat add-on/credit structure using gross-up section fields.
14. **Line 19** = 13A + 18A; **Line 20** = 13B + 18B.
15. **Line 21**: **Presumptive child support** — compare 19 vs 20, net to the column of the parent who owes the **larger** amount (per form language).

**Chart mechanics** (to implement in `lookup-basic-obligation.ts`)

- **Below lowest printed bracket**: proportional scale from $0 to first bracket, or use first bracket only — **pick one** and document (many implementations use proportional from 0; confirm against § 61.30 and local practice).
- **Between brackets**: linear interpolation between adjacent rows (form instructs using the chart when listed).
- **Above highest bracket ($10,000)**: extrapolate using **marginal rate** from the last chart step (last $50 row pair) per child count, unless statute specifies a different formula — align implementation with current § 61.30(6) text at build time.

**Interpolation caveat**: Extracting the chart via `pdf-parse` can **fragment** a few mid-table rows; either repair rows from the statute PDF or interpolate missing rows from neighbors and **snapshot-test** against known anchor points.

---

## 7. PDF Generation (`pdf-lib`) — Multi-Widget Fields

Several AcroForm text fields have **two widgets** under a **single field name** (e.g. **Present Net Monthly Income**) for Petitioner vs Respondent columns. `pdf-lib`’s `setText()` sets a **single** `/V` value — both widgets would show the same text.

**Recommended approach**: after setting the field value if needed for export semantics, call `PDFTextField.updateAppearances(font, (field, widget, font) => { ... })` and use a **custom appearance provider** that renders **different strings per widget** (e.g. order widgets by **x** coordinate: left = Petitioner). Document widget ordering with a one-time diagnostic script.

**Flattening**: today the code calls `form.flatten()`. After adding per-widget appearances:

- Verify flattened output still shows both numbers correctly in Preview/Acrobat; if not, consider **skipping flatten** for this template or flattening only non-problem fields.

---

## 8. API & Client

| Change | Purpose |
|--------|---------|
| `GET .../child-support-worksheet/summary` | Add `calculated: { ... }` with line numbers, presumptive payor, flags (`substantialTimeSharingApplied`, `usedChartExtrapolation`, etc.). |
| Optional `GET .../child-support-worksheet/calculate` | POST body with hypothetical inputs for what-if (no DB write). |

Client worksheet view can show **Presumptive child support** and **disclaimer** that court filings require review.

---

## 9. Testing

- **Unit tests** on `compute-worksheet.ts`: fixed inputs → expected line 2, 4, 9, 21 for at least:
  - One child, combined $2,000, equal incomes (expect **$442** base obligation from chart).
  - Substantial time-sharing case with simple round numbers.
  - Combined income **above $10,000** (extrapolation smoke test).
- **Regression**: when the Supreme Court updates the form, re-run chart generation and update snapshots.

---

## 10. Risks & Disclaimers

- **Net vs gross**: Mislabeling stored “gross” fields as line 1 net will skew all outputs.
- **Statute and chart updates**: The legislature and the Court can change numbers; tie regeneration to the **dated** form revision (e.g. 06/25).
- **Multi-widget PDF quirks**: Appearance streams must be validated on real viewers.
- **Product copy**: Display that FAIS provides **computational assistance**, not legal advice.

---

## 11. Suggested Implementation Phases

1. **Chart + lookup** — generated `chart-data.gen.ts`, tests for interpolation/extrapolation.
2. **Pure `compute-worksheet`** — lines 1–9 only; summary API.
3. **Lines 10–21** — substantial time-sharing path; tests.
4. **PDF fills** — multi-widget appearances + calculated fields; optional credit fields in DB.
5. **UI** — show presumptive amount and chart revision footnote.

---

## 12. Related Files (existing)

- `server/src/lib/child-support-worksheet-pdf.ts` — template fill.
- `server/src/lib/child-support-worksheet-store.ts` — persisted `WorksheetData`.
- `server/src/routes/child-support-worksheet.routes.ts` — HTTP surface.
- `server/scripts/list-child-support-worksheet-pdf-fields.mjs` — field discovery.
- `Read Me/architecture-child-support-worksheet.md` — current workflow (data + PDF, no calculator).
