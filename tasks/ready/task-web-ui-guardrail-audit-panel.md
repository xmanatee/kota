---
id: task-web-ui-guardrail-audit-panel
title: Add guardrail audit trail panel to the web UI dashboard
status: ready
priority: p3
area: operator-ux
summary: The guardrail audit trail (`.kota/audit.jsonl`) records every tool call assessment but is invisible in the web UI. A panel browsing recent assessments would let operators quickly spot blocked calls, understand risk patterns, and verify policy enforcement.
created_at: 2026-03-31T05:28:00Z
updated_at: 2026-03-31T06:42:08Z
---

## Problem

`AuditStore` in `src/guardrails-audit.ts` appends every tool-call assessment to
`.kota/audit.jsonl` with tool name, risk level, policy outcome, reason, and session
ID. The data exists but is only accessible by reading the JSONL file directly. There
is no CLI command and no web UI surface for it.

Operators investigating unexpected behavior — why an agent was blocked, whether a
policy is too restrictive, or which tools trigger the most guardrail hits — must
parse raw JSONL manually. There is no way to browse or filter audit records from the
dashboard.

## Desired Outcome

A "Guardrail Audit" panel in the web UI dashboard that:
- Lists recent audit entries (newest first) with tool, risk level, policy outcome, and short reason.
- Supports filtering by risk level (`low`, `medium`, `high`) and by policy outcome (`allow`, `confirm`, `block`).
- Shows full entry detail on expansion (reason text, session ID, timestamp).
- Loads on demand (static, no SSE needed).

API surface:
- `GET /api/audit` — returns recent audit entries (default last 200, supports `?limit=N&risk=&policy=` filters).

## Constraints

- Use `AuditStore` from `src/guardrails-audit.ts`; do not read `audit.jsonl` directly in the route handler.
- Add server route in a new `src/server/audit-routes.ts`, following the existing pattern of `knowledge-routes.ts` and `memory-routes.ts`.
- Read-only; no create/edit/delete from the web UI.
- Panel is static on load (no SSE needed).
- Do not expose session-level detail beyond the session ID already stored in the audit record.

## Done When

- `GET /api/audit` returns recent entries with tool, risk, policy, reason, ts, and optional session.
- Guardrail Audit panel renders in the web UI with risk and policy filter dropdowns.
- Existing web UI tests pass; at least one new test covers the audit route.
