---
id: task-emit-mcp-task-status-notifications-for-tasks-exten
title: Emit MCP task status notifications for Tasks extension subscriptions
status: ready
priority: p2
area: modules
summary: Add optional notifications/tasks/status support to KOTA's first-party MCP Tasks extension path so subscribed clients can receive task state changes over subscriptions/listen instead of polling only.
created_at: 2026-05-25T10:25:17.090Z
updated_at: 2026-05-25T10:25:17.090Z
---

## Problem

KOTA's first-party MCP server now speaks the official Tasks extension for
long-running tool calls, but the task path is polling-only. The official MCP
Tasks overview also defines optional task status push updates:
`notifications/tasks/status` delivered to clients that opt in through
`subscriptions/listen`.

Local code routes `subscriptions/listen` through the resource/prompt catalog
subscription handler today, and repository search found no
`notifications/tasks/status` implementation. A client that supports the Tasks
extension can poll `tasks/get`, but cannot receive the full task state as it
changes over an already-open subscription stream.

## Desired Outcome

KOTA emits MCP task status notifications for subscribed Tasks-extension
clients while keeping polling as the default path. Clients that opt in through
the official subscription shape receive full task state updates when a task is
created, changes status, requires input, completes, fails, or is cancelled.

Clients that do not negotiate `io.modelcontextprotocol/tasks`, do not subscribe
to task status notifications, or disconnect from their subscription stream do
not receive task status pushes.

## Constraints

- Keep the implementation inside `src/modules/mcp-server/`; MCP protocol task
  state remains module-local and must not become a repo task queue concept.
- Do not add a second task store or a parallel subscription registry. Extend
  the existing handler/transport boundaries deliberately.
- Preserve current `tasks/get`, `tasks/update`, `tasks/cancel`, resource
  subscription, prompt subscription, and HTTP SSE behavior.
- Keep exact wire shapes for `subscriptions/listen` parameters,
  acknowledgement fields, `notifications/tasks/status`, and cancellation in
  source types and focused tests rather than durable docs.
- Treat status notifications as optional protocol capability. Failure to
  subscribe must not make polling clients worse.

## Done When

- `subscriptions/listen` can validate and acknowledge the current Tasks
  extension task-status notification subscription shape for a client that has
  negotiated `io.modelcontextprotocol/tasks`.
- Task lifecycle transitions emit `notifications/tasks/status` containing the
  full current task state to active task-status subscriptions.
- Notification emission covers task creation, `working`, `input_required`,
  terminal `completed` / `failed` / `cancelled`, and input-resume transitions
  without duplicating terminal state after cancellation.
- Stdio and Streamable HTTP SSE paths both deliver task status notifications
  through the existing transport abstraction where they support
  `subscriptions/listen`.
- Unsubscribed clients, clients without the Tasks extension capability, and
  closed/cancelled subscription streams receive no task status notifications.

## Source / Intent

Explorer run `2026-05-25T10-23-38-658Z-explorer-fobegp` refreshed the
never-seen watchlist entry
`https://modelcontextprotocol.io/extensions/tasks/overview` while the local
actionable queue was empty. The overview describes MCP Tasks as an extension
for long-running operations with server-directed task creation, `tasks/get`
polling, `tasks/update` input continuation, cooperative `tasks/cancel`, and
optional `notifications/tasks/status` through `subscriptions/listen`.

Existing completed task
`task-align-mcp-tasks-support-with-official-extension-ne` already covers the
main extension negotiation and method/result contract. The uncovered
nonduplicative gap is push notification support for task state changes.

Local evidence:

- `src/modules/mcp-server/server.ts` routes `subscriptions/listen` to the
  resource subscription handler and routes Tasks methods separately.
- `src/modules/mcp-server/mcp-handlers-resources.ts` acknowledges resource,
  resource-list, and prompt-list subscriptions, but no task status
  notification interest.
- `src/modules/mcp-server/mcp-handlers-tasks.ts` enforces official Tasks
  extension negotiation for polling and updates, but does not fan task state
  changes out as `notifications/tasks/status`.
- Repository search found no existing open task for MCP task status
  notifications.

## Initiative

MCP protocol fidelity: KOTA's first-party MCP server should expose current MCP
extension behavior through one module-owned protocol surface without
accumulating parallel draft paths.

## Acceptance Evidence

- Focused MCP server tests pass, for example
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/streamable-http.test.ts src/modules/mcp-server/mcp-task-store.test.ts src/modules/mcp-server/mcp-protocol-types.test.ts`.
- Protocol tests or fixtures show a Tasks-capable client opening
  `subscriptions/listen`, receiving a subscription acknowledgement, starting a
  task-returning `tools/call`, and then receiving
  `notifications/tasks/status` updates that match subsequent `tasks/get`
  results.
- Negative tests show no task status notifications for clients that did not
  negotiate the Tasks extension, did not subscribe to task status updates, or
  cancelled/closed the subscription stream.
