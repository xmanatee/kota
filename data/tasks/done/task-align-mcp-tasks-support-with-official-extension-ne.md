---
id: task-align-mcp-tasks-support-with-official-extension-ne
title: Align MCP Tasks support with official extension negotiation
status: done
priority: p2
area: modules
summary: Update KOTA's first-party MCP task support from the earlier draft utility shape to the official MCP Tasks extension negotiation and method/result contract.
created_at: 2026-05-25T09:48:43.697Z
updated_at: 2026-05-25T10:09:40Z
---

## Problem

KOTA's MCP task support was implemented against the earlier draft utility
shape from `https://modelcontextprotocol.io/specification/draft/basic/utilities/tasks`.
That shape used a top-level `tasks` capability, requestor-supplied
task-augmentation metadata, `tasks/result`, `tasks/list`, and
`tasks/input_response`.

The current official MCP Tasks documentation now treats Tasks as an extension:
`io.modelcontextprotocol/tasks` is negotiated through
`capabilities.extensions`, task creation is server-directed, clients opt in
through per-request capabilities, `CreateTaskResult` is identified by
`resultType: "task"`, polling flows through `tasks/get`, mid-flight input uses
`tasks/update`, and servers must not return a task to a client that did not
declare extension support.

Local code still reflects the old shape:

- `src/modules/mcp-server/mcp-capabilities.ts` advertises top-level `tasks`.
- `src/modules/mcp-server/server.ts` dispatches `tasks/result`,
  `tasks/input_response`, and `tasks/list`.
- `src/modules/mcp-server/mcp-protocol-types.ts` defines
  `McpCreateTaskResult` without `resultType: "task"` and uses `ttl` /
  `pollInterval` naming.
- `src/modules/mcp-server/mcp-handlers-tools.ts` accepts `params.task`
  directly instead of making task creation depend on the client's
  `io.modelcontextprotocol/tasks` extension capability.

## Desired Outcome

KOTA's first-party MCP server speaks the official Tasks extension contract
while preserving only intentional legacy compatibility. Task support is
advertised through `capabilities.extensions["io.modelcontextprotocol/tasks"]`,
task creation is server-directed for long-running `tools/call` operations, and
every task response shape matches the current extension docs.

Clients that do not declare the Tasks extension keep receiving normal
synchronous results. Clients that do declare it can receive a
`resultType: "task"` response, poll `tasks/get`, resume input with
`tasks/update`, and cancel through `tasks/cancel`.

## Constraints

- Keep the implementation in `src/modules/mcp-server/`; MCP protocol tasks
  remain module-local protocol state, not repo tasks under `data/tasks/`.
- Do not add a second task store. Adapt the existing `mcp-task-store` and
  handlers to the official extension shape.
- Prefer removing the old top-level draft `tasks` public surface. If any
  compatibility path is retained, it must be explicitly version-gated,
  warned, and covered by tests as legacy behavior rather than silently
  accepted alongside the official path.
- Do not return `CreateTaskResult` to a client whose per-request capabilities
  omit `extensions["io.modelcontextprotocol/tasks"]`.
- Keep exact method names, field names, capability ids, and error mappings in
  source and focused protocol tests, not durable docs catalogs.

## Done When

- A single Tasks extension id constant exists and server discovery advertises
  task support through `capabilities.extensions["io.modelcontextprotocol/tasks"]`
  instead of the top-level draft `tasks` capability.
- `tools/call` can return `CreateTaskResult` only when the request's
  `_meta.io.modelcontextprotocol/clientCapabilities.extensions` declares
  `io.modelcontextprotocol/tasks`; otherwise the request stays synchronous or
  fails with a precise protocol error if the tool requires tasks.
- `CreateTaskResult` includes `resultType: "task"` and current extension field
  names (`taskId`, `status`, `createdAt`, `lastUpdatedAt`, `ttlMs`,
  `pollIntervalMs`, plus optional status/input/result fields as appropriate).
- `tasks/get` returns the current task state and includes terminal `result` or
  `error` directly; clients no longer need `tasks/result` on the official path.
- `tasks/update` replaces `tasks/input_response` for input-required task
  continuation and acknowledges unknown or already-satisfied inputs according
  to the extension docs.
- `tasks/cancel` acknowledges cancellation as cooperative and cannot let late
  tool completion overwrite a terminal cancelled state.
- `tasks/list`, `tasks/result`, top-level `tasks` capabilities, and
  requestor-supplied `params.task` behavior are either removed from the
  official path or isolated behind an explicit legacy/draft compatibility gate
  with focused tests.
- `server/discover`, initialize/discovery fixtures, server-card capability
  summaries, and MCP server tests all describe one official Tasks surface.

## Source / Intent

Explorer run `2026-05-25T09-46-30-810Z-explorer-wq9gb5` refreshed MCP's
current release-candidate docs while the local actionable queue was empty. The
MCP blog's May 21, 2026 release-candidate summary says long-running work now
ships through the Tasks extension, and the official Tasks page defines
`io.modelcontextprotocol/tasks` extension negotiation, server-directed task
creation, `resultType: "task"`, `tasks/get`, `tasks/update`, and
`tasks/cancel`.

Sources:

- https://blog.modelcontextprotocol.io/tags/mcp/
- https://modelcontextprotocol.io/extensions/tasks/overview
- https://modelcontextprotocol.io/extensions/overview
- Older draft KOTA implemented from:
  https://modelcontextprotocol.io/specification/draft/basic/utilities/tasks

## Initiative

MCP protocol fidelity: KOTA's first-party MCP server should track the official
extension surface without accumulating parallel draft/public protocol paths.

## Acceptance Evidence

- Focused MCP server tests pass, for example
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-task-store.test.ts src/modules/mcp-server/mcp-protocol-types.test.ts src/modules/mcp-server/server-card.test.ts`.
- Protocol fixtures or tests show an extension-capable client receiving
  `resultType: "task"`, polling through `tasks/get`, resuming input through
  `tasks/update`, and cancelling through `tasks/cancel`.
- A negative test shows a client without
  `extensions["io.modelcontextprotocol/tasks"]` never receives a task result.
- A discovery/server-card assertion shows top-level draft `tasks` capability is
  absent from the official path, or explicitly legacy-gated if retained.
