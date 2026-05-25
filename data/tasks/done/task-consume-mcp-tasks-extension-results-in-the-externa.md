---
id: task-consume-mcp-tasks-extension-results-in-the-externa
title: Consume MCP Tasks extension results in the external client runtime
status: done
priority: p2
area: core
summary: Teach KOTA's external MCP client to opt into official Tasks extension responses, poll task handles, resume input-required tasks, and surface durable diagnostics instead of treating resultType=task as malformed.
created_at: 2026-05-25T12:51:02.213Z
updated_at: 2026-05-25T13:18:05.000Z
---

## Problem

KOTA's first-party MCP server now speaks the official MCP Tasks extension:
server-directed `CreateTaskResult` responses, `tasks/get`, `tasks/update`,
`tasks/cancel`, and optional `notifications/tasks/status` subscriptions are
covered by completed server-side tasks.

The external MCP client path in `src/core/mcp/` is still shaped around
synchronous tool results plus draft `input_required`. The client result decoder
accepts `resultType: "complete"` and `resultType: "input_required"` for
`tools/call`; any other result type is treated as malformed. That means KOTA
can expose long-running tasks from its own MCP server but cannot consume the
same official Tasks extension from a remote MCP server without failing at the
client boundary.

The current MCP Tasks overview defines client responsibilities explicitly:
declare extension support, handle polymorphic task results, poll `tasks/get`,
submit mid-flight input through `tasks/update`, and persist task ids so work can
resume after reconnects. KOTA needs that behavior in the core external-client
runtime, not another first-party server task.

## Desired Outcome

KOTA's external MCP client can consume official Tasks extension responses from
remote MCP servers through the existing core MCP client and manager:

- Per-request MCP client capabilities can opt into
  `io.modelcontextprotocol/tasks` when the operator/runtime allows remote task
  consumption.
- `tools/call` decodes `resultType: "task"` as a strict typed
  `CreateTaskResult` instead of a malformed result.
- The manager follows the task handle to terminal state via `tasks/get`,
  respecting `pollIntervalMs`, TTL, abort/cancellation, and redacted diagnostic
  boundaries.
- If a remote task reaches `input_required`, the existing remote input resolver
  path fulfills input through `tasks/update` rather than treating the task as an
  unsupported result shape.
- Task status notifications from `subscriptions/listen` may update local state,
  but polling remains the default and correctness does not depend on push
  support.

## Constraints

- Keep implementation in `src/core/mcp/`; `src/core/mcp/AGENTS.md` says the
  external client is a session-loop runtime primitive and must not import the
  first-party `mcp-server` module.
- Do not reuse the first-party server's `mcp-task-store`; remote task handles
  belong to the remote server. KOTA only stores the client-side handle, polling
  state, and operator-visible diagnostics it needs.
- Extension opt-in must be explicit and typed. Do not silently advertise Tasks
  support for call paths that cannot poll, update, cancel, and time out safely.
- Preserve existing synchronous, `input_required`, cache hint, progress,
  logging, OAuth, static-header, and `subscriptions/listen` behaviors.
- Keep remote server output untrusted. Task final results, status messages, and
  input requests must pass through the same decoders and manager boundaries as
  ordinary remote MCP results.
- Do not leak bearer tokens, remote task payload secrets, authorization
  headers, or input-response content in thrown messages, console output, or run
  artifacts.

## Done When

- `src/core/mcp/client-protocol.ts` has typed client-side representations for
  official Tasks extension capability metadata, `CreateTaskResult`, task state,
  `tasks/get`, `tasks/update`, and `tasks/cancel` responses.
- `decodeCallToolResult` accepts `resultType: "task"` and rejects malformed task
  fields with precise boundary errors instead of accepting partial handles.
- `McpClient` can issue `tasks/get`, `tasks/update`, and `tasks/cancel` over
  stdio and Streamable HTTP transports using the same header/version rules as
  other MCP methods.
- `McpManager.executeTool` can complete a remote task-backed `tools/call` by
  polling until terminal success/failure/cancellation, routing
  `input_required` task states through the existing input resolver, and
  cancelling on operator abort when cancellation is supported.
- Task handles are recorded durably enough for operator diagnosis and restart
  recovery, or the task explicitly introduces a follow-up for any storage
  limitation that prevents full crash-resume support.
- Negative tests cover malformed `CreateTaskResult`, missing task extension
  negotiation, unknown task ids, timeout/TTL expiry, failed and cancelled
  terminal states, input-required task update errors, abort-triggered
  cancellation, and token/payload redaction.
- Existing external MCP client tests for synchronous calls, `input_required`,
  progress/log notifications, OAuth authorization, cache hints, and resource /
  prompt operations remain green.

## Source / Intent

Explorer run `2026-05-25T12-48-32-513Z-explorer-rpmnda` reviewed an empty
actionable queue. All strategic blocked alternatives exposed by `inspect-queue`
still require operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://modelcontextprotocol.io/extensions/tasks/overview` describes MCP
  Tasks as the official extension for long-running operations. It requires
  clients to opt in with `io.modelcontextprotocol/tasks`, handle polymorphic
  `CreateTaskResult` responses, poll `tasks/get`, respond to mid-flight
  `input_required` through `tasks/update`, and persist task ids for recovery.
- `https://modelcontextprotocol.io/extensions/overview` documents extension
  negotiation through `capabilities.extensions` and graceful degradation when
  only one side supports an extension.

Local evidence:

- `src/core/mcp/AGENTS.md` identifies the external MCP client and manager as
  core session-loop primitives.
- `src/core/mcp/client-result-decoders.ts` currently rejects `tools/call`
  `resultType` values other than `complete` and `input_required`.
- `src/core/mcp/client-protocol.ts` models `McpCallToolResult` as legacy,
  complete, or input-required only; there is no client-side task result union.
- Completed server-side tasks
  `task-align-mcp-tasks-support-with-official-extension-ne` and
  `task-emit-mcp-task-status-notifications-for-tasks-exten` cover KOTA as an
  MCP server, not KOTA consuming remote task-backed MCP tools.

## Initiative

MCP protocol fidelity and safe remote capability use: KOTA should consume the
same official long-running MCP operation model it now serves, without turning
remote task handles into repo tasks or another workflow engine.

## Acceptance Evidence

- Focused external MCP tests pass, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- A protocol fixture or run artifact under `.kota/runs/<run-id>/` shows a fake
  remote MCP server returning `resultType: "task"`, KOTA polling
  `tasks/get`, fulfilling an `input_required` state through `tasks/update`, and
  returning the final tool result to the caller.
- Negative tests or fixtures prove malformed task handles, timeout/expiry,
  failed/cancelled states, missing negotiation, and redaction behavior.
