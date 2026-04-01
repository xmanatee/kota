---
id: task-web-ui-store-writes
title: Add write support for memory and knowledge entries in the web UI
status: done
priority: p3
area: operator-ux
summary: The web UI knowledge and memory panels are read-only. Adding POST and DELETE API routes plus inline create/delete UI would bring parity with the kota memory and kota knowledge CLI commands without leaving the dashboard.
created_at: 2026-04-01T02:26:00Z
updated_at: 2026-04-01T02:26:00Z
---

## Problem

The `kota memory add`, `kota memory delete`, `kota knowledge add`, and `kota knowledge delete`
CLI commands exist, but the web UI knowledge and memory panels only use `GET /api/knowledge`
and `GET /api/memory`. Operators who want to add a quick note or remove a stale memory entry
must switch to the terminal rather than staying in the dashboard.

The server routes layer has no `POST` or `DELETE` handlers for knowledge or memory entries,
so the gap is present at both the API and UI layers.

## Desired Outcome

- `POST /api/memory` and `DELETE /api/memory/:id` server routes that proxy to the in-process
  memory provider (same logic as the `kota memory add` and `kota memory delete` commands).
- `POST /api/knowledge` and `DELETE /api/knowledge/:id` routes with equivalent semantics.
- The web UI memory panel gains an "Add" button that opens an inline form (title + body fields)
  and a delete icon on each entry row.
- The web UI knowledge panel gains the same inline create form and per-row delete action.
- No full-page reload required; panels refresh after write.

## Constraints

- Reuse the existing provider interfaces (`MemoryProvider`, `KnowledgeProvider`) and follow
  the same patterns as the existing CLI command implementations.
- Entry IDs for new entries should be generated server-side, consistent with how the CLI does it.
- No authentication is added — write routes follow the same no-auth stance as existing routes.
- Do not change the CLI commands; this task only adds the HTTP routes and web UI actions.

## Done When

- `POST /api/memory`, `DELETE /api/memory/:id`, `POST /api/knowledge`, `DELETE /api/knowledge/:id`
  are functional and return appropriate status codes.
- The web UI memory and knowledge panels each have inline create and per-row delete UI.
- Panels refresh in place after a write without a full reload.
- Existing panel filter behavior is preserved after create/delete.
- The new routes are covered by at least smoke-level tests.
