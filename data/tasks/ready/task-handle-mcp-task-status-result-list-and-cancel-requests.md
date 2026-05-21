---
id: task-handle-mcp-task-status-result-list-and-cancel-requests
title: Handle MCP task status result list and cancel requests
status: ready
priority: p2
area: modules
summary: Wire tasks/get, tasks/result, tasks/list, and tasks/cancel handlers over the MCP task lifecycle store with strict validation, wait semantics, pagination, cancellation, and precise JSON-RPC errors.
created_at: 2026-05-21T11:19:59Z
updated_at: 2026-05-21T11:53:48.656Z
depends_on: [task-add-mcp-server-task-protocol-types-and-lifecycle-store]
---

## Problem

After the MCP task lifecycle store exists, external clients still have no
protocol path to inspect or control receiver-owned tasks. The parent task
requires `tasks/get`, `tasks/result`, `tasks/list`, and `tasks/cancel`, but
implementing those handlers together with tool execution and MRTR continuation
made the original builder run too broad.

These status and control methods are their own slice: they decode external
params, map store states to draft response shapes, and define JSON-RPC error
behavior before task-augmented tool calls start creating real records.

## Desired Outcome

`src/modules/mcp-server/` has a `tasks` handler area and `server.ts` dispatch
for `tasks/get`, `tasks/result`, `tasks/list`, and `tasks/cancel`. The handlers
operate over the lifecycle store from the predecessor task and can be tested
with seeded task records before `tools/call` creates tasks in production.

The server advertises only the task operations this slice actually implements.
It must not advertise task-augmented `tools/call` support until the follow-up
tool-call slice exists.

## Constraints

- Keep exact method names, params, result shapes, and error mapping in source
  and tests, not durable docs.
- Decode remote MCP input once at the handler boundary, then pass typed data to
  the task store.
- Use the request `taskId` param as the source of truth for `tasks/get`,
  `tasks/result`, and `tasks/cancel`; ignore related-task metadata on those
  requests if present.
- `tasks/result` must return or await the stored terminal result/error, or the
  stored `input_required` result, without inventing a second result format.
- `tasks/cancel` must reject terminal tasks with `-32602` and must not stop the
  daemon, the MCP server, or unrelated workflow runs.

## Done When

- `server.ts` dispatches `tasks/get`, `tasks/result`, `tasks/list`, and
  `tasks/cancel` to a module-local task handler.
- Unknown, expired, malformed, invalid-cursor, and terminal-cancel cases return
  precise JSON-RPC errors, using `-32602` for invalid params.
- `tasks/get` returns the current task state with task id, status, timestamps,
  TTL, status message when present, and poll interval when present.
- `tasks/result` returns immediately for terminal or `input_required` tasks and
  waits for working tasks until they become terminal or input-required.
- `tasks/list` uses opaque cursor pagination and includes `nextCursor` when
  more task records are available.
- `tasks/cancel` transitions cancellable tasks to `cancelled`, settles waiting
  result requests, and rejects already terminal tasks.
- Draft initialize and `server/discover` advertise task list/cancel support
  only after the handlers are wired, while leaving `tasks.requests.tools.call`
  absent until tool-call task creation lands.

## Source / Intent

Decomposed from `task-support-mcp-task-augmented-requests-in-the-mcp-ser`
after builder run `.kota/runs/2026-05-21T06-37-01-293Z-builder-kj321d/`
timed out after 10,800,000 ms.

The official MCP draft Tasks page
(`https://modelcontextprotocol.io/specification/draft/basic/utilities/tasks`)
defines `tasks/get`, `tasks/result`, `tasks/list`, `tasks/cancel`, optional
status notifications, cursor-based listing, and JSON-RPC error behavior for
unknown, expired, malformed, and terminal-cancel task states. The parent task
found no `tasks/get|tasks/result|tasks/cancel|tasks/input_response`
implementation under `src/modules/mcp-server/`.

`pnpm kota task create` was attempted first for the first decomposed slice and
failed before writing with `Fatal: fetch failed`, so this task follows the
normalized schema manually.

## Initiative

MCP protocol fidelity: KOTA should expose current draft MCP long-running
operation semantics through one strict module-owned protocol surface.

## Acceptance Evidence

- Focused MCP server tests pass, for example
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-task-store.test.ts`.
- Protocol fixtures or tests show `tasks/get`, `tasks/result`, `tasks/list`,
  and `tasks/cancel` over seeded working, input-required, completed, failed,
  cancelled, expired, and unknown task records.
