---
id: task-run-mcp-tool-calls-through-task-augmentation
title: Run MCP tool calls through task augmentation
status: backlog
priority: p2
area: modules
summary: Let draft tools/call with params.task create receiver-owned MCP tasks, execute tools asynchronously, preserve the legacy synchronous path, advertise implemented task support, and return final results through tasks/result.
created_at: 2026-05-21T11:19:59Z
updated_at: 2026-05-21T11:19:59Z
depends_on: [task-handle-mcp-task-status-result-list-and-cancel-requests]
---

## Problem

Once the MCP task store and control handlers exist, clients still cannot start
a task. KOTA's first-party MCP server only runs `tools/call` synchronously, so
long-running tool calls cannot return a `CreateTaskResult`, detach, be polled,
be cancelled, or have their final result retrieved through `tasks/result`.

This slice is distinct from the generic task handlers because it must preserve
the existing non-task client behavior while adding a second execution path for
draft `tools/call` requests that include task augmentation.

## Desired Outcome

Draft `tools/call` requests with a valid `params.task` create receiver-owned
MCP task records and return `CreateTaskResult` quickly. The tool execution
continues under that task record, records success, JSON-RPC errors, and tool
`isError` failures consistently, and lets `tasks/result` return exactly the
underlying final result or error.

Clients that do not use task augmentation continue through the existing
synchronous path. Unsupported task metadata on request types KOTA does not
support remains ignored as the draft requires.

## Constraints

- Keep task execution inside the MCP server module and existing tool runner
  boundaries. Do not add a second KOTA tool registry or queue.
- Generate task ids on the receiver side and include working status, ISO
  timestamps, actual TTL, and poll interval in `CreateTaskResult`.
- Cancellation should mark only the task-owned operation cancelled. If the
  underlying runner cannot stop immediately, late completion or failure must
  not mutate the terminal cancelled state.
- Preserve output-schema validation and draft vs legacy tool-result
  conversion semantics.
- Do not require task augmentation for existing tools unless a tool explicitly
  declares that requirement.

## Done When

- `tools/call` with valid `params.task` returns `CreateTaskResult` quickly and
  starts background execution tied to the created MCP task.
- Successful tool calls complete the task and `tasks/result` returns the same
  MCP tool result shape the synchronous call would have returned, including
  required related-task metadata on the result response.
- Tool exceptions, JSON-RPC handler errors, output-schema errors, and tool
  `isError` results move the task to `failed` and are retrievable through
  `tasks/result` according to the draft error rules.
- `tasks/cancel` for a running tool task transitions to `cancelled`, settles
  waiters, and cannot be overwritten by late runner completion.
- Draft initialize and `server/discover` advertise
  `tasks.requests.tools.call` only after this path exists.
- `tools/list` exposes task support through the draft tool-level
  `execution.taskSupport` field consistently with KOTA's actual behavior.
- Existing synchronous MCP server tool-call tests remain green for clients
  that do not send task augmentation.

## Source / Intent

Decomposed from `task-support-mcp-task-augmented-requests-in-the-mcp-ser`
after builder run `.kota/runs/2026-05-21T06-37-01-293Z-builder-kj321d/`
timed out after 10,800,000 ms.

The official MCP draft Tasks page
(`https://modelcontextprotocol.io/specification/draft/basic/utilities/tasks`)
defines task-augmented requests, `CreateTaskResult`, receiver-generated task
ids, result retrieval through `tasks/result`, task cancellation, and
tool-level `execution.taskSupport` negotiation. Local evidence in the parent
task showed `src/modules/mcp-server/mcp-handlers-tools.ts` has only a
synchronous `tools/call` path today.

`pnpm kota task create` was attempted first for the first decomposed slice and
failed before writing with `Fatal: fetch failed`, so this task follows the
normalized schema manually.

## Initiative

MCP protocol fidelity: KOTA should expose current draft MCP long-running
operation semantics through one strict module-owned protocol surface.

## Acceptance Evidence

- Focused MCP server tests pass, for example
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-protocol-types.test.ts`.
- A protocol fixture or test trace shows task-augmented `tools/call`
  returning `CreateTaskResult`, polling with `tasks/get`, retrieving the final
  tool result with `tasks/result`, and cancelling a second running task.
- A regression test shows a non-task client still receives the legacy
  synchronous `tools/call` result.
