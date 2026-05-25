---
id: task-validate-mcp-task-routing-headers-over-streamable-
title: Validate MCP task routing headers over Streamable HTTP
status: ready
priority: p2
area: modules
summary: Require Streamable HTTP tasks/get, tasks/update, and tasks/cancel requests to carry Mcp-Name equal to params.taskId so task polling, updates, and cancellation satisfy SEP-2663 routing semantics.
created_at: 2026-05-25T12:16:22.457Z
updated_at: 2026-05-25T12:16:22.457Z
---

## Problem

KOTA's Streamable HTTP adapter validates standard MCP headers before
dispatching JSON-RPC bodies, but `expectedMcpName()` only requires `Mcp-Name`
for `tools/call`, `prompts/get`, and `resources/read`. Official MCP
SEP-2663 says Streamable HTTP `tasks/get`, `tasks/update`, and `tasks/cancel`
requests must set `Mcp-Name` to the task id so intermediaries can route
follow-up requests for the same server-held task state.

That leaves KOTA's Tasks extension path protocol-correct for the JSON-RPC
body, but under-specified at the HTTP routing boundary.

## Desired Outcome

Streamable HTTP task lifecycle methods require the same strict header/body
consistency as other named MCP methods:

- `tasks/get`, `tasks/update`, and `tasks/cancel` reject requests whose
  `Mcp-Name` header is missing, malformed, or not equal to `params.taskId`.
- Valid task requests with matching `Mcp-Name` keep working over HTTP.
- Stdio task behavior remains unchanged.

## Constraints

- Keep the change inside `src/modules/mcp-server/`; this is MCP transport
  validation, not core task-queue behavior.
- Do not reintroduce official `tasks/list` or other draft task surfaces while
  fixing the routing headers.
- Preserve existing `Mcp-Method`, `MCP-Protocol-Version`, resource, prompt,
  tool, and `x-mcp-header` validation behavior.
- Keep exact header/method/error contracts in source types and focused tests,
  not durable docs.

## Done When

- `expectedMcpName()` or its replacement treats `tasks/get`, `tasks/update`,
  and `tasks/cancel` as task-id-routed methods.
- Streamable HTTP tests cover success and negative cases for missing and
  mismatched `Mcp-Name` on each official task lifecycle method.
- Existing task-status notification, task polling, task update, task cancel,
  and standard header mismatch tests remain green.

## Source / Intent

Explorer run `2026-05-25T12-13-56-382Z-explorer-2x54lz` refreshed MCP Tasks
sources while the local actionable queue was empty. SEP-2663 is final and
adds a Streamable HTTP routing-header requirement that was not captured by the
two completed Tasks-extension tasks.

Sources:

- https://modelcontextprotocol.io/seps/2663-tasks-extension
- https://modelcontextprotocol.io/extensions/tasks/overview

Local evidence:

- `src/modules/mcp-server/streamable-http.ts` validates `Mcp-Name` only for
  `tools/call`, `prompts/get`, and `resources/read`.
- `src/modules/mcp-server/streamable-http.test.ts` covers task status
  notifications over HTTP but creates task requests without task-id
  `Mcp-Name` validation.
- Completed tasks
  `task-align-mcp-tasks-support-with-official-extension-ne` and
  `task-emit-mcp-task-status-notifications-for-tasks-exten` cover the main
  extension contract and notifications, not this routing-header requirement.

## Initiative

MCP protocol fidelity: KOTA's first-party MCP server should expose current MCP
extension behavior through one strict module-owned transport surface.

## Acceptance Evidence

- Focused MCP server tests pass, for example
  `pnpm test src/modules/mcp-server/streamable-http.test.ts src/modules/mcp-server/server.test.ts`.
- Protocol tests show `tasks/get`, `tasks/update`, and `tasks/cancel` over
  Streamable HTTP rejecting missing or wrong `Mcp-Name` before dispatch, and
  accepting matching `Mcp-Name: <taskId>`.
