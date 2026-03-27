# FAIS AI Query Response Contract v2

This document defines the low-risk response contract rollout for `/admin/query`.

The contract is additive: legacy fields stay in place while new clients read `answer`.

## Goals

- Keep AI responses accurate and plain English.
- Support both list-style and aggregate-style answers in one shape.
- Preserve backward compatibility during rollout.
- Expose telemetry for quality and reliability tracking.

## API shape

`POST /admin/query` now returns:

```json
{
  "clarification": "string optional",
  "answer": {
    "plainEnglishSummary": "string",
    "list": {
      "applies": true,
      "columns": ["string"],
      "rows": [{}],
      "truncated": false,
      "rowLimit": 25
    },
    "aggregate": {
      "applies": false,
      "metrics": [
        { "name": "Returned rows", "value": 12, "unit": "count" }
      ],
      "breakdowns": [
        {
          "dimension": "_id",
          "buckets": [{ "key": "1", "value": 8400 }]
        }
      ]
    },
    "caveats": ["string"],
    "queryUsed": "stringified JSON query",
    "resultMeta": {
      "queryType": "find",
      "intent": "list",
      "rowCountReturned": 12,
      "executionMs": 41,
      "executionNote": "Query executed successfully.",
      "validationFailed": false
    }
  },
  "summary": "legacy field",
  "summaryList": ["legacy field"],
  "summarySections": [{ "title": "legacy field", "items": ["legacy"] }],
  "count": 12,
  "results": []
}
```

## Interpretation rules

- `answer.plainEnglishSummary` is the primary user-facing text.
- `answer.list` is for record details and small row previews.
- `answer.aggregate` is for totals, averages, top-N and grouped results.
- `answer.caveats` communicates assumptions/truncation.
- `answer.queryUsed` supports traceability/debugging.
- `answer.resultMeta` supports product telemetry and dashboards.

## Clarification behavior

When the question is ambiguous, the API returns:

- `clarification` text
- an `answer` object with intent `clarify`
- legacy fields (`summary`, `count`, `results`) for backward compatibility

No query is executed in clarification mode.

## Telemetry endpoint

`GET /admin/ai-query/telemetry` returns aggregate counters and recent request entries:

- totals: `requests`, `clarifications`, `validationFailures`, `success`
- intent distribution: `list`, `aggregate`, `both`, `clarify`
- query type distribution: `find`, `aggregate`
- recent entries include duration and validation outcome

## Rollout sequence

1. Phase 1: backend emits `answer` plus legacy fields.
2. Phase 2: UI reads `answer` first, falls back to legacy fields.
3. Phase 3: stricter intent-aware prompt rules + more aggregate examples.
4. Phase 4: telemetry endpoint + dashboard cards in Admin Query page.
