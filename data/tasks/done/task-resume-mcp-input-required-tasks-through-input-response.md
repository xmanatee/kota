---
id: task-resume-mcp-input-required-tasks-through-input-response
title: Resume MCP input-required tasks through input_response
status: done
priority: p2
area: modules
summary: Bridge tasks/input_response to the existing MRTR requestState/inputResponses path so task-owned input_required tool calls resume without a second owner-question channel.
created_at: 2026-05-21T11:19:59Z
updated_at: 2026-05-21T12:55:41.822Z
depends_on: [task-run-mcp-tool-calls-through-task-augmentation]
---

## Problem

Task-augmented tool execution is incomplete without the draft
`input_required` continuation path. KOTA's MCP server already has MRTR helpers
for draft input-required tool results and retries, but task-owned operations
must expose those input requests through `tasks/result` and resume through
`tasks/input_response`.

If this bridge is implemented inline with tool-call task creation, the result
is another broad change that repeats the parent task's timeout shape and risks
creating a parallel owner-question or approval channel.

## Desired Outcome

Task-owned MCP tool calls that need input move to `input_required`.
`tasks/result` returns the existing `InputRequiredResult` shape with
`inputRequests` and optional `requestState`. `tasks/input_response` validates
the task id, current status, input responses, and request state, then feeds the
same MRTR continuation path used by non-task draft tool calls.

The result is one MRTR implementation with task-aware routing, not a second
input or approval mechanism.

## Constraints

- Preserve the existing MRTR boundary in `mcp-mrtr.ts`; do not invent a
  parallel state token, owner-question channel, or approval surface.
- Validate `inputResponses` and optional `requestState` through the same
  strict decoding path used by draft input-required retries.
- `tasks/input_response` must reject unknown tasks, expired tasks,
  non-`input_required` tasks, malformed responses, and stale request state with
  precise JSON-RPC errors.
- Related-task metadata must be attached where the draft requires it, while
  `taskId` params remain the source of truth for task control requests.
- Keep progress and status notification behavior bounded; polling must remain
  sufficient for correctness.

## Done When

- A task-augmented input-required tool call records `input_required` state and
  wakes any waiting `tasks/result` request with an `InputRequiredResult`.
- `tasks/input_response` exists, decodes params strictly, rejects tasks that are
  not waiting for input with `-32602`, and resumes the underlying operation via
  the existing MRTR `inputResponses` and `requestState` path.
- Accepted input transitions the task back to `working`, then to the correct
  terminal state when the resumed tool operation completes or fails.
- The final `tasks/result` response contains the underlying result or JSON-RPC
  error and preserves related-task metadata required by the draft.
- Tests cover accepted input, decline/cancel input responses, malformed input,
  stale request state, input for the wrong task, expiry while input-required,
  and cancellation while input-required.
- Optional status notifications and progress-token behavior are covered where
  the transport can safely emit them, but polling remains enough to complete
  the protocol flow.

## Source / Intent

Decomposed from `task-support-mcp-task-augmented-requests-in-the-mcp-ser`
after builder run `.kota/runs/2026-05-21T06-37-01-293Z-builder-kj321d/`
timed out after 10,800,000 ms.

The official MCP draft Tasks page
(`https://modelcontextprotocol.io/specification/draft/basic/utilities/tasks`)
defines `input_required` status, `tasks/result` returning
`InputRequiredResult`, and `tasks/input_response` carrying `inputResponses` and
optional `requestState`. Local code already has `src/modules/mcp-server/mcp-mrtr.ts`
for MRTR state and input-response validation; this task makes task-owned calls
use that surface.

`pnpm kota task create` was attempted first for the first decomposed slice and
failed before writing with `Fatal: fetch failed`, so this task follows the
normalized schema manually.

## Initiative

MCP protocol fidelity: KOTA should expose current draft MCP long-running
operation semantics through one strict module-owned protocol surface.

## Acceptance Evidence

- Focused MCP server tests pass, for example
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-protocol-types.test.ts`.
- A protocol fixture or test trace shows a task-augmented tool call reaching
  `input_required`, `tasks/result` returning input requests, `tasks/input_response`
  resuming the operation, and a later `tasks/result` returning the final tool
  result without any separate owner-question path.
