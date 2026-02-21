# Long Form Affidavit — Template Creation and Rendering

This document describes how the **long form** financial affidavit template is chosen, populated with data, and rendered as a PDF in FAIS. It covers the official AcroForm-based PDF path (Florida 12.902(c)-style form), not the alternate HTML/Playwright PDF path. For how **short vs long** is selected and for the shared client/server flow, see also `architecture-short-form-affidavit.md`.

---

## 1. Overview

- **Long form** is used when the user’s **gross annual income** (derived from employment data) is **at or above** the fixed threshold ($50,000). Below the threshold, the **short form** (12.902(b)-style) is used.
- The **template** is a static, fillable PDF file: `fl-financial-affidavit-long.pdf`, stored under the server’s `private/forms` directory.
- **Creation** = choosing long form (via summary or explicit `form=long`) + loading the long template. **Rendering** = filling the template’s AcroForm fields with data from the app (Mongo + user/case) and returning a flattened PDF.
- The long form includes **numbered sections** for income (1–18), deductions (19–27), household expenses (1_2–20_2), and **assets/liabilities** (including “Other” rows).

---

## 2. Template Source and Location

| Item | Detail |
|------|--------|
| **Long form file** | `fl-financial-affidavit-long.pdf` |
| **Short form file** | `fl-financial-affidavit-short.pdf` (see short-form doc) |
| **Directory** | `server/private/forms/` (relative to server `process.cwd()`) |
| **Loading** | `loadTemplatePdf('long')` in `server/src/routes/affidavit.routes.ts` reads the file and loads it with **pdf-lib** (`PDFDocument.load(bytes)`). |
| **Missing template** | If the file is missing, the server returns 500 with a message instructing to place the official form PDFs under `server/private/forms/`. |

The template is an **official AcroForm PDF**. Field names can be inspected at runtime via `GET /affidavit/pdf-template/fields?form=long` (returns form field names and types for the loaded template).

---

## 3. Form Selection (Short vs Long)

Form selection is the same as for the short form:

- **Summary:** `computeAffidavitSummary(targetUserObjectId)` computes gross annual income from employment and uses threshold `50_000`. `form = grossAnnualIncome < threshold ? 'short' : 'long'`.
- **PDF request:** `GET /affidavit/pdf-template?form=auto` uses that summary to pick the template; `?form=long` forces the long form regardless of income.

See **Section 3** of `architecture-short-form-affidavit.md` for full details.

---

## 4. Data Sources for Filling the Long Form

Data is **user-scoped** (and optionally tied to a **case** for caption). All affidavit data is read via `server/src/lib/affidavit-store.js` and MongoDB:

| Data | Collection / source | Usage in long form |
|------|----------------------|---------------------|
| User identity | `User` (firstName, lastName, uname) | “I full legal name” |
| Employment | `employment` | Employer, occupation, pay rate, pay frequency (Hourly/Weekly/Biweekly/Monthly checkboxes) |
| Monthly income | `monthlyincome` (typeId + amount + ifOther) | Fields 1–16 (with 9a/9b for alimony), other source; totals in 17 (monthly), 18 (annual) |
| Monthly deductions | `monthlydeductions` | Fields 19–26 (with 25a/25b for alimony); total in 27 |
| Monthly household expenses | `monthlyhouseholdexpense` | Fields 1_2 through 20_2 by typeId |
| **Assets** | `assets` | “Other” assets (assetsTypeId 19) → Other assetsRow1..7 (description — market value) |
| **Liabilities** | `liabilities` | “Other” liabilities (liabilitiesTypeId 9) → Other liabilitiesRow1..6 (description — amount owed) |
| Case (optional) | `case` + lookups | Same caption fields as short form (Case No, Division, Circuit, county, Petitioner, Respondent) |

The long form is the one that **uses assets and liabilities** in the PDF mapping; the short form does not populate asset/liability fields.

---

## 5. Client-Side Flow (Creation and Request)

The client flow is **identical** to the short form:

1. **Affidavit page** loads summary → displays “Short form” or “Long form” based on `summary.form`.
2. User clicks “Generate PDF” → `AffidavitService.generateOfficialPdf('auto', userId, caseId)` → `GET /affidavit/pdf-template?form=auto` (optional `userId`, `caseId`).
3. When the server chooses long form (income ≥ threshold or `form=long`), the response is the filled long-form PDF; the client saves it as e.g. `financial-affidavit-long.pdf`.

See **Section 5** of `architecture-short-form-affidavit.md` for details.

---

## 6. Server-Side Flow (Template Creation and Rendering)

Endpoint: `GET /affidavit/pdf-template` (auth required). Shared steps (resolve user, form key, load template, strip instruction pages, case caption, collect data, flatten, send) are the same as for the short form. Below is what is **specific to the long form** when `formKey === 'long'`.

1. **Load template and prepare PDF**
   - `loadTemplatePdf('long')` → `fl-financial-affidavit-long.pdf`.
   - `stripLeadingInstructionPages(pdf, 3)`.
   - Case caption is filled the same way as short form (if case is resolved).

2. **Collect affidavit data**
   - Same parallel load: employment, monthlyincome, monthlydeductions, monthlyhouseholdexpense, **assets**, **liabilities** (all user-scoped).

3. **Map data into long form fields**

   **Identity and employment**
   - `I full legal name` ← user full name
   - `Employed by` ← primary employment employer name
   - `My occupation is` ← primary employment occupation
   - `Pay rate` ← primary employment pay rate (string)
   - Pay frequency checkboxes (exact names): `Hourly` (typeId 9), `Weekly` (1), `Biweekly` (2), `Monthly` (3)

   **Monthly income (Section I — numbered fields)**
   - `monthlyincome` rows aggregated by `typeId`; amounts written to fields **1**–**16**:
     - typeId 9 → `9a From this case`
     - typeId 10 → `9b From other cases`
     - All others → field name = String(typeId) (e.g. `1`, `2`, …, `16`)
   - typeId 16 “other” description → `Any other income of a recurring nature identify source`
   - Total monthly income → field **17**
   - Total annual income (monthly × 12) → field **18**

   **Monthly deductions (Section I — 19–27)**
   - `monthlydeductions` aggregated by typeId; mapping:
     - typeId 1→`19`, 2→`20`, 3→`21`, 4→`22`, 5→`23`, 6→`24`, 7→`25`
     - typeId 8 → `25a From this case`
     - typeId 9 → `25b From other cases`
     - typeId 10 → `26`
   - Total deductions → field **27**

   **Monthly household expenses**
   - `monthlyhouseholdexpense` aggregated by typeId; amount for typeId `n` (1–20) → field **`n_2`** (e.g. 1_2, 2_2, …, 20_2).

   **Assets (best-effort)**
   - Rows with `assetsTypeId === 19` (“Other”) up to 7; each row: description and market value joined as `"description — value"` into `Other assetsRow1` … `Other assetsRow7`.

   **Liabilities (best-effort)**
   - Rows with `liabilitiesTypeId === 9` (“Other”) up to 6; each row: description and amount owed into `Other liabilitiesRow1` … `Other liabilitiesRow6`.

4. **Flatten and send**
   - `form.flatten()` then `pdf.save()`; response with `Content-Disposition: attachment; filename="financial-affidavit-long.pdf"`.

---

## 7. Field Mapping Summary (Long Form)

| Section | Field pattern | Data source | Notes |
|--------|----------------|-------------|--------|
| Identity | `I full legal name`, `Employed by`, `My occupation is`, `Pay rate` | User, primary employment | Exact names |
| Pay frequency | `Hourly`, `Weekly`, `Biweekly`, `Monthly` | employment.payFrequencyTypeId | Checkboxes |
| Income | `1`…`16`, `9a From this case`, `9b From other cases` | monthlyincome by typeId | typeId 9/10 use a/b |
| Income other | `Any other income of a recurring nature identify source` | monthlyincome typeId 16 ifOther | |
| Income totals | `17` (monthly), `18` (annual) | Sum of monthlyincome | |
| Deductions | `19`…`26`, `25a From this case`, `25b From other cases` | monthlydeductions by typeId | typeId 8/9 use a/b |
| Deductions total | `27` | Sum of monthlydeductions | |
| Household expenses | `1_2`…`20_2` | monthlyhouseholdexpense by typeId | typeId n → field n_2 |
| Other assets | `Other assetsRow1`…`Other assetsRow7` | assets where assetsTypeId=19 | description — marketValue |
| Other liabilities | `Other liabilitiesRow1`…`Other liabilitiesRow6` | liabilities where liabilitiesTypeId=9 | description — amountOwed |

The long template may contain additional fields (e.g. more detailed asset/liability lines); the code documents that mapping is “minimal best-effort” and can be expanded as template field names are confirmed via `/affidavit/pdf-template/fields?form=long`.

---

## 8. Summary Diagram

```
[User] → Affidavit page
           → GET /affidavit/summary     → computeAffidavitSummary()
           → display "Long form" (when income ≥ $50k)
           → "Generate PDF"
           → GET /affidavit/pdf-template?form=auto&caseId=...
                    ↓
           resolve user → form=auto → summary.form → 'long'
                    ↓
           loadTemplatePdf('long')  →  fl-financial-affidavit-long.pdf
                    ↓
           stripLeadingInstructionPages(3)
                    ↓
           listAffidavitRows(employment, monthlyincome, monthlydeductions,
                             monthlyhouseholdexpense, assets, liabilities)
           User + Case (caption)
                    ↓
           pdf.getForm() → long-form block:
             identity (I full legal name, Employed by, occupation, Pay rate)
             pay frequency checkboxes
             income 1–16, 9a/9b, 17/18
             deductions 19–27, 25a/25b
             expenses 1_2..20_2
             Other assetsRow1..7, Other liabilitiesRow1..6
                    ↓
           form.flatten() → pdf.save() → response PDF
                    ↓
           [Client] save blob as financial-affidavit-long.pdf
```

---

## 9. Related Code and Docs

- **Server:** `server/src/routes/affidavit.routes.ts` — long-form block (~lines 808–914): identity, pay frequency, income 1–18, deductions 19–27, expenses 1_2–20_2, other assets/liabilities.
- **Store:** `server/src/lib/affidavit-store.js` — `listAffidavitRows('assets', filter)`, `listAffidavitRows('liabilities', filter)` (same as short form; long form is the consumer for PDF mapping).
- **Client:** Same as short form — `affidavit.page.ts`, `affidavit.service.ts` (`generateOfficialPdf`).
- **Short form doc:** `Read Me/architecture-short-form-affidavit.md` — form selection, client flow, template location, caption.
- **General API:** `Read Me/architect.md` (Affidavit API section).
