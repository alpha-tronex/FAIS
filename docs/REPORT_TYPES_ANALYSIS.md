# Report Types Analysis (Current App Setup)

This document describes what types of reports you can generate with the app as it is currently implemented.

---

## Overview

The app has **two report entry points**, both backed by the same data engine (`report-runner.ts`) and the same row shape. They differ in how the user describes the report (structured vs natural language) and which filters the AI is allowed to infer.

| Entry point | Route / Page | API | AI prompt type |
|-------------|--------------|-----|----------------|
| **Structured** | `/reports/structured` | `POST /reports/query-structured` | Income + role + “about user” only |
| **Natural**   | `/reports/natural`   | `POST /reports/query-natural`   | Income + role + children + “about user” |

**Access:** Only **Petitioner Attorney (role 3)** and **Administrator (role 5)** can open report pages and call report APIs. Petitioner attorneys see only cases where they are `petitionerAttId`; admins see all cases (and can optionally filter “about user X”).

---

## 1. Data behind every report

All reports are built from:

- **Cases** the requester is allowed to see (by role).
- **Party on the case:** either **respondent** or **petitioner** (one per row).
- **Gross annual income** of that party: from **affidavit employment data only** (see `affidavit-summary.ts`: `grossAnnualIncome` is set from employment rows, not from monthly-income breakdown).
- **Number of children** on the case (when using the natural-language report and children filters).

So every report is a list of **cases** with one **party** per case (respondent or petitioner), plus that party’s income and optional children count.

---

## 2. Report types you can generate

Conceptually, there are **four kinds** of reports. Both UIs can produce (1)–(3); only the natural-language UI is wired for (4).

### 2.1 Income-only (by role)

- **Criteria:** Choose respondent or petitioner, then filter by **gross annual income** (min and/or max).
- **Examples:** “Respondents under 50K”, “Petitioners over 100K”, “Respondents between 30K and 80K”.
- **Available in:** Structured and Natural.

### 2.2 “About user” (single user)

- **Criteria:** “About user &lt;username&gt;” — show only cases where that user is involved (as petitioner, respondent, or attorney/assistant). The report still shows one party per row (respondent or petitioner) and that party’s income.
- **Examples:** “Tell me about user admin”, “About user john”.
- **Available in:** Structured and Natural.

### 2.3 Income + “about user”

- **Criteria:** Same as “about user”, but only for cases where the party’s income meets a range (e.g. “about user X, respondents under 50K” — if the natural-language parser allows it; structured prompt is focused on either income filters or “about user”).
- **Available in:** Depends on how the AI maps the prompt; the backend supports `filterUserId` plus income criteria together.

### 2.4 Children filter

- **Criteria:** Filter cases by **number of children** (min and/or max), plus optional role and income.
- **Examples:** “Cases with 3 or more children”, “Respondents with 2–4 children”.
- **Available in:** **Natural-language report only.** The structured report does not expose `numChildrenMin` / `numChildrenMax`.

---

## 3. Output shape (same for all)

Every report returns:

- **rows:** Array of:
  - `caseId`, `caseNumber`
  - `partyRole`: `"respondent"` | `"petitioner"`
  - `partyName`
  - `grossAnnualIncome`
  - `under50K`: boolean
  - `numChildren` (optional; used when children filters are applied)
- **narrative:** Short AI-generated summary sentence(s).

The **Structured** table does not show a “Children” column; the **Natural** table shows it when any row has `numChildren` set.

---

## 4. Summary table

| Report type | Structured UI | Natural UI | Filters used |
|------------|---------------|------------|--------------|
| Income by role (respondent/petitioner) | ✅ | ✅ | `roleType`, `incomeMin`, `incomeMax` |
| “About user” (single user) | ✅ | ✅ | `filterByUsername` → `filterUserId` |
| Income + “about user” | ⚠️ (if AI maps it) | ⚠️ (if AI maps it) | As above combined |
| By number of children | ❌ | ✅ | `numChildrenMin`, `numChildrenMax` (+ optional role/income) |

---

## 5. Requirements for reports to run

- **OPENAI_API_KEY** (or **OPENAI_KEY**) must be set in `server/.env`; otherwise report endpoints return **503**.
- Income is derived from **affidavit employment data** only (see `server/src/lib/affidavit-summary.ts`). Cases/parties without that data are effectively excluded from income-based reports (or show as zero, depending on implementation).
- “About user” requires a valid **username** in the system; the backend resolves it to a user id and filters cases by that user’s involvement.

---

## 6. What you cannot do (current setup)

- **Other report types:** No dedicated reports for, e.g., case status, dates, or other schema fields — only income, role, children, and “about user.”
- **Children in Structured:** The structured prompt and UI do not support children filters; use Natural for that.
- **Multiple users:** “About user” is single-user only.
- **Export:** The app returns JSON (rows + narrative); there is no built-in CSV/PDF export in this analysis.

This reflects the codebase as of the analysis date; implementation details are in `server/src/routes/reports.routes.ts`, `server/src/lib/report-runner.ts`, and `server/src/lib/affidavit-summary.ts`.
