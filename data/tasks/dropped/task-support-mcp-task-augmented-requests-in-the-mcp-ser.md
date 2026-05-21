---
id: task-support-mcp-task-augmented-requests-in-the-mcp-ser
title: Support MCP task-augmented requests in the MCP server
status: dropped
priority: p2
area: modules
summary: Implement the experimental MCP Tasks utility for task-augmented tool calls, task polling/result retrieval, cancellation, and task input responses so long-running MCP operations have a strict protocol path instead of ad-hoc waiting.
created_at: 2026-05-21T05:39:28.823Z
updated_at: 2026-05-21T11:19:59Z
---

## Problem

The MCP draft now includes an experimental Tasks utility for long-running
request handling: task-augmented requests create a receiver-owned task, clients
can poll with `tasks/get`, retrieve or block on `tasks/result`, list and cancel
tasks, and provide MRTR-style input via `tasks/input_response`.

KOTA's MCP server has already absorbed much of the current draft surface:
tools, resources, prompts, completion, progress notifications, MRTR,
elicitation, roots, and sampling are represented in the module. It also
validates a draft `tasks` client capability key during request metadata
parsing. But there is no task state machine, no `tasks/*` handlers, and no
task-augmented `tools/call` path. Long-running MCP operations therefore remain
either synchronous, progress-only, or MRTR-only; external MCP clients cannot
detach from a long operation, poll for status, cancel it, or retrieve its final
result through the draft task protocol.

## Desired Outcome

`src/modules/mcp-server/` supports the experimental MCP Tasks utility for the
server-side paths KOTA owns. A task-augmented `tools/call` can return a
`CreateTaskResult` quickly, keep executing under a typed in-memory task record,
and expose status/result/cancel/input-response behavior through strict
`tasks/*` handlers.

The implementation should make task support explicit rather than accidental:
KOTA advertises task capability only where it actually implements the request
type, ignores task metadata on unsupported request types as the draft requires,
and treats malformed task state or invalid transitions as protocol errors.

## Constraints

- Keep the work inside the MCP server module unless a reusable runtime
  primitive is genuinely needed. Do not create a second project task queue or
  confuse MCP protocol tasks with KOTA's `data/tasks/` work queue.
- Implement a typed task lifecycle with only the draft transitions: `working`
  may move to `input_required`, `completed`, `failed`, or `cancelled`;
  `input_required` may move back to `working` or to a terminal state; terminal
  tasks never transition again.
- Preserve the existing MRTR boundary. `tasks/input_response` should feed the
  same validated `inputResponses` and optional `requestState` path used by
  input-required results, not introduce a parallel owner-question or approval
  channel.
- Cancellation should abort only the task-owned operation and return an
  explicit cancelled task state. It must not stop the daemon, the MCP server,
  or unrelated workflow runs.
- TTL, timestamps, pagination, and poll interval behavior should be deliberate
  and tested. Do not leave unbounded task records in process memory.
- Keep compatibility narrow. Existing non-task MCP clients should continue to
  receive normal synchronous behavior unless KOTA explicitly advertises and
  requires task augmentation for a request type.
- Treat all remote MCP input as untrusted external I/O: validate shape once at
  the MCP boundary and expose typed internal results afterward.

## Done When

- Draft initialize/discovery behavior advertises task support only for request
  types KOTA implements, and tests prove unsupported task metadata is ignored
  rather than changing behavior.
- `tools/call` with task augmentation returns a `CreateTaskResult` with a
  receiver-generated unique `taskId`, `working` status, ISO timestamps, TTL,
  and poll interval.
- `tasks/get`, `tasks/result`, `tasks/list`, `tasks/cancel`, and
  `tasks/input_response` are implemented with focused validation and precise
  JSON-RPC errors for unknown tasks, malformed params, invalid status, and
  expired tasks.
- `tasks/result` returns the underlying tool result or JSON-RPC error for
  terminal tasks, blocks or awaits until terminal or `input_required` for
  working tasks, and returns an `InputRequiredResult` for input-required tasks.
- Task status notifications are emitted where the transport can safely do so,
  but polling remains sufficient for correctness.
- Existing MCP server tests remain green, and new tests cover success,
  cancellation, failure, input-required continuation, task expiry, pagination,
  and a non-task client continuing through the legacy synchronous path.

## Source / Intent

Explorer run `.kota/runs/2026-05-21T04-23-33-828Z-explorer-ilk2tl/` found the
queue empty with all strategic blocked alternatives waiting on
operator-captured evidence. The official MCP draft Tasks page
(`https://modelcontextprotocol.io/specification/draft/basic/utilities/tasks`)
is a new nonduplicative protocol-fidelity source for KOTA. The page defines
task-augmented requests, `tasks/get`, `tasks/result`, `tasks/list`,
`tasks/cancel`, `tasks/input_response`, optional status notifications, strict
status transitions, TTL/resource-management requirements, and result retrieval
behavior.

Repo evidence: `src/modules/mcp-server/server.ts` already validates a draft
`tasks` client capability key, but `src/modules/mcp-server/` has no task
handler module and `rg "tasks/get|tasks/result|tasks/cancel|tasks/input_response"`
finds no implementation.

## Initiative

MCP protocol fidelity: KOTA should consume and expose current MCP draft
features through one strict module-owned protocol surface, especially where
long-running operations overlap with progress, MRTR, elicitation, and
operator-visible cancellation.

## Acceptance Evidence

- Test transcript for focused MCP server coverage, for example
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-protocol-types.test.ts`.
- A protocol fixture or test trace showing a task-augmented `tools/call`
  returning `CreateTaskResult`, polling with `tasks/get`, retrieving the final
  result with `tasks/result`, and cancelling a second long-running task.
- A fixture covering `input_required` task continuation through
  `tasks/input_response` without a separate owner-question path.

## Decomposed

Dropped because builder run
`.kota/runs/2026-05-21T06-37-01-293Z-builder-kj321d/` timed out while trying
to implement the full MCP task utility in one slice. The work is now split
into smaller, dependency-ordered tasks:

- `task-add-mcp-server-task-protocol-types-and-lifecycle-store`
- `task-handle-mcp-task-status-result-list-and-cancel-requests`
- `task-run-mcp-tool-calls-through-task-augmentation`
- `task-resume-mcp-input-required-tasks-through-input-response`
