# Child Support Guidelines Worksheet — Workflow and Data Model

This document describes the **Child Support Guidelines Worksheet** workflow in FAIS: data model, API, edit flow, and PDF generation. The workflow mirrors the financial affidavit (template load, target resolution, summary, PDF fill, print) and adds worksheet-specific storage and an edit page.

---

## 1. Overview

- **Template:** Official Florida fillable PDF: `fl-child-support-guidelines-worksheet.pdf`, stored under `server/private/forms/`.
- **Data sources:** (1) **Worksheet-specific data** stored in the `childsupportworksheet` collection (one document per user + case). (2) **Reused data** from affidavit (income) and case (parties, case number).
- **Flow:** User (or admin) selects target user/case → view summary → edit worksheet data (optional) → generate filled PDF for download/print.
- **Target resolution:** Same as affidavit: admin by `userId`; petitioner attorney / legal assistant by `caseId` → petitioner; respondent / respondent attorney by `caseId` → petitioner (view-only). Resolved via `resolveAffidavitTarget`.

---

## 2. Template and Location

| Item | Detail |
|------|--------|
| **Worksheet file** | `fl-child-support-guidelines-worksheet.pdf` |
| **Directory** | `server/private/forms/` |
| **Template key** | `'child-support-worksheet'` (in `affidavit-pdf.ts` or shared PDF helper) |
| **Loading** | `loadTemplatePdf('child-support-worksheet')` loads the file with **pdf-lib**. |
| **Field discovery** | Run `node server/scripts/list-child-support-worksheet-pdf-fields.mjs` to list AcroForm field names for mapping. |

---

## 3. Data Model: Worksheet Document

One document per **(userId, caseId)** in the `childsupportworksheet` collection.

| Field | Type | Description |
|-------|------|--------------|
| `userId` | ObjectId | User the worksheet is for (e.g. petitioner). |
| `caseId` | ObjectId | Case (optional; if omitted, worksheet is “global” for that user). |
| `data` | object | Worksheet-specific fields (see below). |
| `createdAt` | Date | First save. |
| `updatedAt` | Date | Last update. |

**`data` shape (flexible; extend as PDF fields are mapped):**

- **Children:** `numberOfChildren`, `childNames[]`, `childDatesOfBirth[]`, etc.
- **Income (monthly):** `parentAMonthlyGrossIncome`, `parentBMonthyGrossIncome` (or reuse affidavit summary).
- **Timesharing:** `overnightsParentA`, `overnightsParentB`, `timesharingPercentageParentA`, `timesharingPercentageParentB`.
- **Other:** `healthInsuranceMonthly`, `daycareMonthly`, `otherChildCareMonthly`, `mandatoryUnionDues`, `supportPaidForOtherChildren`, etc.

The PDF filler reads this document plus affidavit/case data and maps into the template’s AcroForm fields by name (needle match, same pattern as affidavit).

---

## 4. API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/child-support-worksheet/summary` | requireAuth | Query: `userId?`, `caseId?`. Returns summary (target user display name, case, income from affidavit, worksheet data snapshot). |
| GET | `/api/child-support-worksheet/pdf` | requireAuth | Query: `userId?`, `caseId?`. Returns filled PDF (attachment). |
| GET | `/api/child-support-worksheet` | requireAuth | Query: `userId?`, `caseId?`. Returns the worksheet document (for edit form). |
| PUT | `/api/child-support-worksheet` | requireAuth | Body: `{ data: { ... } }`. Upserts worksheet for resolved target user/case. |
| GET | `/api/child-support-worksheet/pdf-template/fields` | requireAuth | Returns list of PDF form field names (for debugging). |

Target resolution for all: same as affidavit (`resolveAffidavitTarget`). Respondents (2, 4) may only view (summary + PDF); edit and PUT restricted to petitioner side / admin.

---

## 5. Server-Side Flow

**Summary**

1. `resolveAffidavitTarget(req)` → `targetUserObjectId` (and optional case from query).
2. Load affidavit summary (income) for target user; load worksheet doc from `childsupportworksheet` by userId + caseId.
3. Return combined summary (display name, case, income, worksheet fields).

**PDF generation**

1. Resolve target user (and case).
2. Load template: `loadTemplatePdf('child-support-worksheet')`.
3. Get form: `pdf.getForm()`; build field-name list; define `setTextByNeedle` / `checkByNeedle` (as in affidavit).
4. Load worksheet doc + affidavit summary + case/party data.
5. Map data into form fields (exact or needle match).
6. Flatten form; `pdf.save()` → buffer; respond with PDF.

**Worksheet GET/PUT**

- GET: find one document by `userId` + `caseId` (or userId only if caseId not required). Return `{ data }` or empty.
- PUT: validate body; upsert document (userId, caseId from resolved target, `data`, `updatedAt`).

---

## 6. Client-Side Flow

**View page** (`/child-support-worksheet`)

- Query params: `userId`, `caseId` (same semantics as affidavit).
- On load: call `ChildSupportWorksheetService.summary(userId?, caseId?)` → show summary.
- “Generate PDF” → `generatePdf(userId?, caseId?)` → download blob (e.g. `child-support-guidelines-worksheet.pdf`).
- Link “Edit worksheet data” → `/child-support-worksheet/edit?userId=…&caseId=…`.

**Edit page** (`/child-support-worksheet/edit`)

- Same query params. Guard: same as affidavit edit (block respondent/respondent attorney).
- On load: `getWorksheet(userId?, caseId?)` → populate form.
- Form sections: e.g. Children, Income (or “from affidavit”), Timesharing, Health insurance / daycare, Other.
- Save → `saveWorksheet(userId?, caseId?, data)` (PUT). Then navigate back to view or stay and show success.

**Admin**

- Admin can open worksheet for any petitioner (select user + case) and view/edit/generate PDF (same API with `userId` + `caseId`).
- Nav: link “Child support worksheet” next to “Affidavit” (e.g. in header or under Admin).

---

## 7. Field Mapping Strategy

- **Discovery:** Use `list-child-support-worksheet-pdf-fields.mjs` to get exact AcroForm field names from the PDF.
- **Resilient mapping:** As in affidavit, use needle-based helpers (`setTextByNeedle`, `checkByNeedle`) so small naming differences between template versions are tolerated.
- **Missing fields:** All setters ignore missing fields (no throw). Document which worksheet `data` keys map to which needles in the filler code.

---

## 8. Summary Diagram

```
[User] → Child support worksheet page
           → GET /child-support-worksheet/summary  → resolve target, affidavit summary, worksheet doc
           → display summary
           → "Generate PDF"
           → GET /child-support-worksheet/pdf
                    ↓
           resolve target → loadTemplatePdf('child-support-worksheet')
                    ↓
           load worksheet doc + affidavit summary + case
                    ↓
           pdf.getForm() → setTextByNeedle / checkByNeedle
                    ↓
           form.flatten() → pdf.save() → response PDF
                    ↓
           [Client] save as child-support-guidelines-worksheet.pdf

[User] → Child support worksheet edit page
           → GET /child-support-worksheet  → worksheet doc
           → edit form → PUT /child-support-worksheet  → upsert doc
```

---

## 9. Related Code and Docs

- **Server:** `server/src/lib/affidavit-pdf.ts` (template key + path), `server/src/lib/child-support-worksheet-store.ts`, `server/src/lib/child-support-worksheet-pdf.ts`, `server/src/routes/child-support-worksheet.routes.ts`.
- **Script:** `server/scripts/list-child-support-worksheet-pdf-fields.mjs`.
- **Client:** `client/src/app/services/child-support-worksheet.service.ts`, `client/src/app/pages/child-support-worksheet/`, `client/src/app/pages/child-support-worksheet-edit/`.
- **Affidavit reference:** `Read Me/architecture-short-form-affidavit.md`.
