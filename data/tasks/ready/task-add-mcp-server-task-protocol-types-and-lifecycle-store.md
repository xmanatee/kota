---
id: task-add-mcp-server-task-protocol-types-and-lifecycle-store
title: Add MCP server task protocol types and lifecycle store
status: ready
priority: p2
area: modules
summary: Introduce a strict in-memory MCP task model, transition validator, TTL cleanup, cursor pagination, and focused tests without wiring task-augmented tool execution yet.
created_at: 2026-05-21T11:19:59Z
updated_at: 2026-05-21T11:19:59Z
---

## Problem

The MCP server currently validates that draft client capabilities may contain a
`tasks` key, but it has no server-owned protocol model for MCP tasks. The
oversized parent task tried to cover task creation, polling, result retrieval,
cancellation, input continuation, capability advertisement, and fixtures in one
builder run and timed out.

Without a small lifecycle surface first, later `tasks/*` handlers and
task-augmented `tools/call` support would need to invent state rules inline.
That risks mixing MCP protocol tasks with KOTA's repo task queue and makes
transition, TTL, pagination, and waiter behavior hard to test independently.

## Desired Outcome

`src/modules/mcp-server/` gains a module-local MCP task state model and
in-memory lifecycle store that can be exercised without public wire handlers.
The store owns task ids, status transitions, timestamps, TTL expiration,
poll-interval metadata, stored results or JSON-RPC errors, waiting result
requests, cancellation settlement, and paginated listing.

This slice should leave external behavior unchanged until the follow-up handler
tasks wire the store into JSON-RPC dispatch.

## Constraints

- Keep the implementation inside `src/modules/mcp-server/`; MCP protocol tasks
  are not KOTA repo tasks under `data/tasks/`.
- Model only the draft statuses and transitions: `working` may move to
  `input_required`, `completed`, `failed`, or `cancelled`; `input_required`
  may move back to `working` or to a terminal state; terminal tasks never
  transition again.
- Treat malformed internal task state as a loud error. External params are
  decoded later at the handler boundary.
- Make TTL and pagination deterministic in tests. Do not leave records
  unbounded in process memory.
- Do not advertise task capability or add `tasks/*` method dispatch in this
  slice unless the handlers also land in the same change.

## Done When

- MCP task protocol types exist for task status, task records, task creation
  results, stored terminal results/errors, input-required results, and list
  pages.
- A module-local task store generates receiver-owned unique task ids, records
  ISO timestamps, applies TTL and poll interval policy, and exposes explicit
  operations for create, read, transition, complete, fail, cancel, wait for
  result, expire, and list page.
- The store rejects invalid transitions and terminal-state mutation loudly.
- Waiters for `tasks/result` are settled when a task reaches terminal or
  `input_required`, and cancellation cannot be overwritten by late completion.
- Focused tests cover creation, transition validation, terminal immutability,
  waiter settlement, TTL expiry, and cursor pagination.

## Source / Intent

Decomposed from `task-support-mcp-task-augmented-requests-in-the-mcp-ser`
after builder run `.kota/runs/2026-05-21T06-37-01-293Z-builder-kj321d/`
timed out after 10,800,000 ms.

The official MCP draft Tasks page
(`https://modelcontextprotocol.io/specification/draft/basic/utilities/tasks`)
defines receiver-generated task ids, task statuses, allowed transitions, TTL
resource management, result retrieval, cancellation behavior, and cursor-based
listing. The parent task confirmed that `src/modules/mcp-server/server.ts`
only validates a draft `tasks` capability key today; there is no task state
machine or task handler module.

`pnpm kota task create "Add MCP server task protocol types and lifecycle store"
--state ready --area modules --priority p2 --summary "Introduce a strict
in-memory MCP task model, transition validator, TTL cleanup, cursor pagination,
and focused tests without wiring task-augmented tool execution yet."` was
attempted first and failed before writing with `Fatal: fetch failed`, so this
task follows the normalized schema manually.

## Initiative

MCP protocol fidelity: KOTA should expose current draft MCP long-running
operation semantics through one strict module-owned protocol surface.

## Acceptance Evidence

- Focused MCP server task-store tests pass, for example
  `pnpm test src/modules/mcp-server/mcp-task-store.test.ts src/modules/mcp-server/mcp-protocol-types.test.ts`.
- Test fixtures show valid and invalid lifecycle transitions, TTL expiry, a
  paginated listing, and a waiting result request settling when task state
  changes.
