---
id: task-web-ui-knowledge-panel
title: Add knowledge store browser panel to the web UI dashboard
status: backlog
priority: p3
area: operator-ux
summary: The knowledge store is only accessible via the CLI (`kota knowledge`). The web dashboard has no surface for browsing or searching knowledge entries, leaving operators without a fast way to inspect what structured reference data the agents are working with.
created_at: 2026-03-31T04:39:00Z
updated_at: 2026-03-31T04:39:00Z
---

## Problem

`kota knowledge list` and `kota knowledge show <id>` expose the knowledge store via
the CLI, but the web dashboard has no equivalent panel. Operators who want to inspect
or verify knowledge entries must switch to the terminal, and there is no way to search
or filter entries without scripting.

The memory and knowledge CLI commands (`kota memory`, `kota knowledge`) are implemented
in `src/memory-cli.ts` using the `ProviderRegistry`; the server has no corresponding
API routes for these stores.

## Desired Outcome

A "Knowledge" panel in the web UI dashboard that:
- Lists all knowledge entries with id, title/key, and a short excerpt.
- Supports a simple text filter/search within the loaded entries.
- Shows full entry content on expansion or click.
- Follows the existing panel component pattern (approvals, tasks, sessions).

A `GET /api/knowledge` route returns the list; `GET /api/knowledge/:id` returns a
single entry. Read-only; no create/edit/delete from the web UI.

## Constraints

- Add server routes in a new `src/server/knowledge-routes.ts` following the pattern
  of existing route files.
- Use the `KnowledgeProvider` from `ProviderRegistry`; do not bypass the provider
  abstraction.
- No changes to the knowledge store itself.
- Panel is static on load (no SSE needed).
- Memory store is out of scope for this task to keep scope narrow.

## Done When

- `GET /api/knowledge` returns a list of knowledge entries (id, title/key, excerpt).
- `GET /api/knowledge/:id` returns full entry content.
- Knowledge panel renders in the web UI with text filter support.
- Existing web UI tests pass; new behavior covered by at least one test.
