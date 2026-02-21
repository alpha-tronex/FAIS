# Short Form Affidavit — Template Creation and Rendering

This document describes how the **short form** financial affidavit template is chosen, populated with data, and rendered as a PDF in FAIS. It covers the official AcroForm-based PDF path (Florida 12.902(b)-style form), not the alternate HTML/Playwright PDF path.

---

## 1. Overview

- **Short form** is used when the user’s **gross annual income** (derived from employment and/or monthly income data) is **below a fixed threshold** ($50,000). Above the threshold, the **long form** (12.902(c)-style) is used.
- The **template** is a static, fillable PDF file: `fl-financial-affidavit-short.pdf`, stored under the server’s `private/forms` directory.
- **Creation** = choosing short vs long (via summary) + loading the correct template. **Rendering** = filling the template’s AcroForm fields with data from the app (Mongo + user/case) and returning a flattened PDF.

---

## 2. Template Source and Location

| Item | Detail |
|------|--------|
| **Short form file** | `fl-financial-affidavit-short.pdf` |
| **Long form file** | `fl-financial-affidavit-long.pdf` |
| **Directory** | `server/private/forms/` (relative to server `process.cwd()`) |
| **Loading** | `loadTemplatePdf(key)` in `server/src/routes/affidavit.routes.ts` reads the file from disk and loads it with **pdf-lib** (`PDFDocument.load(bytes)`). |
| **Missing template** | If the file is missing, the server returns 500 with a message instructing to place the official form PDFs under `server/private/forms/`. |

The template is an **official AcroForm PDF** (text fields and checkboxes). Field names can be inspected at runtime via `GET /affidavit/pdf-template/fields?form=short` (returns form field names and types for the loaded template).

---

## 3. Form Selection (Short vs Long)

Form selection is driven by **gross annual income** and a **fixed threshold**:

1. **Summary computation** (`computeAffidavitSummary` in `affidavit.routes.ts`):
   - **Employment income:** From `employment` rows: `payRate × payFrequencyToAnnualMultiplier(payFrequencyTypeId)` (e.g. weekly × 52, monthly × 12).
   - **Monthly income:** Sum of `monthlyincome` rows (user-scoped); annual = monthly × 12.
   - **Gross annual income** used for the threshold is the employment-based total (not combined with monthly income in the current logic).
   - **Threshold:** `50_000`.
   - **Form:** `form = grossAnnualIncome < threshold ? 'short' : 'long'`.

2. **API:**
   - `GET /affidavit/summary` returns `{ grossAnnualIncome, threshold, form: 'short' | 'long', ... }`. The client uses this to show “Form to generate: Short form” or “Long form”.
   - For PDF generation, the client calls `GET /affidavit/pdf-template?form=auto` (or `short`/`long`). When `form=auto`, the server calls `computeAffidavitSummary` again and uses the returned `form` to select the template key.

---

## 4. Data Sources for Filling the Short Form

Data is **user-scoped** (and optionally tied to a **case** for caption). All affidavit data is read via `server/src/lib/affidavit-store.js` and MongoDB:

| Data | Collection / source | Usage in short form |
|------|----------------------|----------------------|
| User identity | `User` (firstName, lastName, uname) | Full legal name |
| Employment | `employment` | Primary job: employer, occupation, pay rate, pay frequency (checkboxes), “unemployed” checkbox |
| Monthly income | `monthlyincome` (typeId + amount + ifOther) | Salary/wages, bonuses, business, disability, unemployment, pension, SS, alimony, interest, rental, other, total gross income |
| Monthly deductions | `monthlydeductions` | Taxes, FICA, Medicare, union, retirement, health, child support, alimony paid, etc., and total deductions |
| Monthly household expenses | `monthlyhouseholdexpense` | Mortgage/rent, property tax, utilities, telephone, food, meals, maintenance, other; total monthly expenses |
| Case (optional) | `case` + lookups | Case number, division, circuit, county, petitioner/respondent names for caption |

Lookups (e.g. circuit/county names) use `lookup_circuits`, `lookup_counties`; petitioner/respondent names come from populated `User` or case party references.

---

## 5. Client-Side Flow (Creation and Request)

1. **Affidavit page** (`client/src/app/pages/affidavit/affidavit.page.ts`):
   - User (or admin with `?userId=`) opens the affidavit view.
   - On load, the page calls `AffidavitService.summary(userId)` → `GET /affidavit/summary`.
   - The UI displays the summary (gross annual income, threshold, **form: short or long**) and a “Generate PDF” button.

2. **Generate PDF:**
   - User clicks “Generate PDF”.
   - Page calls `AffidavitService.generateOfficialPdf('auto', userId, caseId)` → `GET /affidavit/pdf-template?form=auto` (and optional `userId`, `caseId`).
   - Response is a **blob** (application/pdf). The client uses `FileSaveService.savePdf(blob, fileName)` to trigger download (e.g. `financial-affidavit-short.pdf`).

3. **AffidavitService** (`client/src/app/services/affidavit.service.ts`):
   - `generateOfficialPdf(form, userId?, caseId?)` is the only path that uses the **official template**; the other `generatePdf()` uses the HTML/Playwright pipeline.

So from the user’s perspective: **creation** = the server “creating” the filled PDF by choosing the short-form template and filling it; **rendering** = the browser receiving and saving that PDF.

---

## 6. Server-Side Flow (Template Creation and Rendering)

Endpoint: `GET /affidavit/pdf-template` (auth required).

1. **Resolve target user**
   - `resolveAffidavitTarget(req)`: uses JWT; if `?userId=` is present, requires admin and resolves that user; otherwise uses the authenticated user’s id. Result: `targetUserObjectId`.

2. **Form key**
   - Query: `form=auto | short | long`. If `auto`, call `computeAffidavitSummary(targetUserObjectId)` and use `summary.form`; otherwise use the requested form. Result: `formKey` = `'short'` or `'long'`.

3. **Load template and prepare PDF**
   - `loadTemplatePdf(formKey)` → load `fl-financial-affidavit-short.pdf` (or long) from `private/forms`.
   - **Strip instruction pages:** `stripLeadingInstructionPages(pdf, 3)` removes the first 3 pages so the generated PDF contains only the fillable form.
   - `form = pdf.getForm()` (pdf-lib AcroForm).

4. **Case caption (optional)**
   - If `?caseId=` is provided, use that case (must include target user). Otherwise, use the most recent case that includes the target user.
   - Look up circuit/county names from lookup collections; petitioner/respondent from case + User. Fill caption fields: Case No, Division, Circuit No, county, “IN THE CIRCUIT COURT OF THE”, “IN AND FOR”, Petitioner, Respondent (exact field names from the template; `setTextIfExists` skips missing fields).

5. **Collect affidavit data**
   - In parallel: `listAffidavitRows('employment', filter)`, `listAffidavitRows('monthlyincome', filter)`, same for `monthlydeductions`, `monthlyhouseholdexpense`, `assets`, `liabilities` (short form uses employment, monthly income, deductions, household expenses; assets/liabilities are used more in long form).
   - User profile: `User.findById(targetUserObjectId)` for name; primary employment row for employer, occupation, pay rate, pay frequency.

6. **Map data into short form fields**
   - **Identity:** full legal name, occupation, employed by, pay rate.
   - **Pay frequency:** checkboxes (e.g. “every week”, “every other week”, “twice a month”, “monthly”, “other”) from `payFrequencyTypeId`; “unemployed” checked when there are no employment rows.
   - **Income:** monthly income rows aggregated by `typeId` (e.g. 1 = salary/wages, 2 = bonuses, … 9/10 = alimony this case/other, 16 = other with ifOther). Amounts written to template fields by name (e.g. “monthly gross salary or wages”, “monthly bonuses, commissions”, … “total present monthly gross income”). Uses `setTextByNeedle` for flexible name matching.
   - **Deductions:** same idea; amounts by typeId into fields like “monthly federal, state, and local income tax”, … “total deductions allowable under section 61.30”.
   - **Net income:** total monthly income − total deductions → “present net monthly income” / “total present monthly net income”.
   - **Household expenses:** by typeId (mortgage/rent, property taxes, utilities, telephone, food, meals outside home, maintenance, other). Total → “total monthly expenses 1/2”.
   - **Surplus/deficit:** net monthly − total household; surplus or deficit field set accordingly.
   - **Date:** today’s date into “date” / “dated” fields.

   Helpers:
   - `setTextIfExists(form, fieldName, value)` — get text field by name, set value; ignore if field missing.
   - `checkIfExists(form, fieldName, checked)` — get checkbox, check/uncheck; ignore if missing.
   - `findFieldName(needle)` — resolve a logical name to the template’s actual field name (exact or partial match). Used by `setTextByNeedle` / `checkByNeedle` so one code path can tolerate small template naming differences.

7. **Flatten and send**
   - `form.flatten()` so filled values are “baked” into the page content (not editable form fields).
   - `pdf.save()` → bytes; response `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="financial-affidavit-short.pdf"`.

---

## 7. Field Mapping Strategy

- **Exact names:** Many short-form fields are set with `setTextIfExists(form, 'fieldName', value)` using the exact AcroForm field name (e.g. `'full legal name'`, `'occupation'`, `'employed by'`, `'pay rate'`).
- **Resilient names:** For fields that may vary by template revision, the code uses `setTextByNeedle` / `checkByNeedle` with a short “needle” string; `findFieldName(needle)` finds a form field whose name contains the needle (case-insensitive). This allows the same logic to work across minor PDF revisions.
- **Missing fields:** All setters catch errors and ignore missing fields so one codebase can support slightly different template versions.

To see the actual field names for the short form template, call `GET /affidavit/pdf-template/fields?form=short` and use the returned list when adding or debugging mappings.

---

## 8. Summary Diagram

```
[User] → Affidavit page
           → GET /affidavit/summary     → computeAffidavitSummary()
           → display "Short form" / "Long form"
           → "Generate PDF"
           → GET /affidavit/pdf-template?form=auto&caseId=...
                    ↓
           resolve user → form=auto → computeAffidavitSummary().form → 'short'
                    ↓
           loadTemplatePdf('short')  →  fl-financial-affidavit-short.pdf
                    ↓
           stripLeadingInstructionPages(3)
                    ↓
           listAffidavitRows(employment, monthlyincome, monthlydeductions, monthlyhouseholdexpense, …)
           User + Case (caption)
                    ↓
           pdf.getForm() → setTextIfExists / checkIfExists / setTextByNeedle / checkByNeedle
                    ↓
           form.flatten() → pdf.save() → response PDF
                    ↓
           [Client] save blob as financial-affidavit-short.pdf
```

---

## 9. Related Code and Docs

- **Server:** `server/src/routes/affidavit.routes.ts` — summary, pdf-template, pdf-template/fields, loadTemplatePdf, stripLeadingInstructionPages, short-form block (~lines 676–806).
- **Store:** `server/src/lib/affidavit-store.js` — userScopedFilter, listAffidavitRows, listEmploymentRowsForUser.
- **Client:** `client/src/app/pages/affidavit/affidavit.page.ts`, `affidavit.page.html`; `client/src/app/services/affidavit.service.ts` (generateOfficialPdf).
- **General API overview:** `Read Me/architect.md` (Affidavit API section).
