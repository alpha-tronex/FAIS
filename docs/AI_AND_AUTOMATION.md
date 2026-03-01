# AI and Automation in FAIS

This document summarizes how AI and automation are used in the app, and what logged-in users can (and cannot) do. Use it as a reference for future work.

---

## 1. AI usage

AI is used in two places:

**Reports**

1. **Parsing prompts** — `callLLM()` turns natural or structured text into report parameters (income, role, county, “about user”, etc.).
2. **Narrative generation** — `generateNarrative()` turns report rows into a short narrative.
3. **“About user” summaries** — Built in `getAboutUserSummary()` in `server/src/lib/report-runner.ts` from DB data (name, attorney, county, employment, income, children, next appointment). **No LLM** is used here; it’s aggregation and formatting only.

**Ask to schedule**

4. **Schedule-from-prompt** — On the **Upcoming Events** page, users who can create appointments (Petitioner Attorney, Legal Assistant, Admin) see a “Schedule by ask” section. They can type a natural-language request (e.g. “schedule user john with attorney jane on 3/3/2026 from 1PM to 2PM”). The backend uses the same OpenAI client (`server/src/lib/openai.ts`) to parse the prompt into petitioner username, attorney or legal assistant username, date/time, and duration, then resolves usernames, finds the case, and creates the appointment (same permissions and invite flow as the regular Schedule button). API: `POST /appointments/schedule-from-prompt` with body `{ prompt: string }`.

---

## 2. Automation (server-only, not user-driven)

The only automation is a **fixed server job**:

- **`server/src/jobs/appointment-reminder.job.ts`** — A cron job runs daily at 6:00 PM server time. It finds appointments scheduled for the next calendar day and sends reminder emails to the petitioner and petitioner attorney via `invite-email.service.ts`.

There is **no**:

- User-configurable scheduled tasks
- “Run this report every week” or similar
- User-defined automations or workflows
- API or UI for a logged-in user to create or manage automated tasks

**Conclusion:** Logged-in users **cannot** automate tasks in the app. Only the built-in appointment reminder exists, and it is not configurable by users.

---

## 3. Quick reference

| Area            | What exists                                                                 |
|-----------------|-----------------------------------------------------------------------------|
| **AI**          | Reports: prompt parsing + narrative generation; “about user” is DB-only. **Ask to schedule:** natural-language parsing on Upcoming Events to create an appointment. |
| **Automation**  | One server cron: daily appointment reminders. No user-defined automation.    |

---

## 4. Possible extensions (for later)

- **More AI:** e.g. summarization or suggestions on affidavits, case notes, or search; chatbot for “ask about my cases”.
- **User automation:** e.g. “Run report X every Monday and email me,” or “Remind me when a new case matches Y,” backed by stored preferences and a job runner that respects auth and report-access rules.
