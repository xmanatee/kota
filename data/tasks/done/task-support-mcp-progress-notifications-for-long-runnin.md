---
id: task-support-mcp-progress-notifications-for-long-runnin
title: Support MCP progress notifications for long-running operations
status: done
priority: p2
area: modules
summary: Align KOTA's MCP client and server with the draft progress utility so long-running MCP requests can request, emit, validate, and surface notifications/progress without leaking stale or unbounded updates.
created_at: 2026-05-21T02:08:00Z
updated_at: 2026-05-21T02:23:32.678Z
---

## Problem

The MCP draft Progress utility defines `progressToken` request metadata and
`notifications/progress` updates for long-running operations. KOTA's MCP
client and first-party MCP server already track draft per-request metadata,
subscriptions, tool-list changes, MRTR, prompts, resources, tools, and
completion, but a repository scan found no `progressToken` or
`notifications/progress` handling.

That leaves long-running MCP requests as all-or-nothing waits: remote servers
cannot send structured progress into KOTA's external-tool runtime, and KOTA's
first-party MCP server cannot emit bounded progress for operations such as
large resource reads, task/workflow subscription setup, prompt rendering, or
tool calls that already have observable internal progress.

## Desired Outcome

KOTA supports MCP progress as a strict protocol utility on both sides:

- As an MCP client, KOTA can include a `progressToken` for long-running remote
  calls when the caller opts into progress, accepts only valid
  `notifications/progress` for active request tokens, and records or surfaces
  bounded progress without treating it as tool result content.
- As an MCP server, KOTA can emit `notifications/progress` for selected
  long-running first-party methods when the incoming request includes a token,
  while stopping progress after completion or cancellation.
- Progress handling is rate-limited or coalesced so an external server cannot
  flood session context, logs, or run artifacts with unbounded progress events.

## Constraints

- Keep client-side handling in `src/core/mcp/`; it is consumed by the session
  loop and external MCP tool manager.
- Keep first-party server handling in `src/modules/mcp-server/`; do not move
  server helpers into core.
- Do not turn progress notifications into chat-visible tool output. They are
  protocol side-channel events and should remain bounded metadata, warnings,
  or operator-visible run/session timeline entries.
- Validate active tokens strictly. Ignore or warn on notifications for unknown,
  completed, cancelled, or malformed tokens rather than accepting stale updates.
- Preserve existing cancellation behavior: after `notifications/cancelled`,
  progress for that request must stop and late progress must be ignored.
- Do not add a prose catalog of MCP payloads to docs; exact wire shapes belong
  in source types and focused protocol tests.

## Done When

- `src/core/mcp/client.ts` tracks active progress tokens for requests that opt
  in, handles `notifications/progress`, validates monotonic progress values
  for each token, and exposes a bounded progress callback or event suitable
  for the session/runtime layer.
- `src/modules/mcp-server/` can detect incoming `progressToken` metadata and
  emit valid `notifications/progress` from at least one representative
  long-running method without emitting progress for requests that did not ask
  for it.
- Cancellation and completion clear token state on both sides; late or unknown
  progress notifications are ignored or logged without mutating tool results.
- Focused tests cover client receipt, server emission, monotonic validation,
  cancellation cleanup, and flood/coalescing behavior.
- Existing MCP tests for draft metadata, subscriptions/listen, tools, prompts,
  resources, MRTR, completion, and elicitation remain green.

## Source / Intent

Explorer review of the official MCP draft on 2026-05-21 found a remaining
protocol-fidelity gap after the recent MCP task burst. The draft Progress page
states that either side may include `progressToken` metadata and then send
`notifications/progress` with increasing progress values, optional totals, and
human-readable messages:

- https://modelcontextprotocol.io/specification/draft/basic/utilities/progress
- https://modelcontextprotocol.io/specification/draft/basic/utilities/cancellation

Local evidence: `rg "progressToken|notifications/progress" src data/tasks`
returned no existing support or task, while `src/core/mcp/client.ts` and
`src/modules/mcp-server/server.ts` already implement adjacent draft metadata,
subscription, and cancellation surfaces.

## Initiative

MCP protocol fidelity: KOTA should consume and expose MCP draft utilities
strictly, with bounded side channels and no parallel protocol surface.

## Acceptance Evidence

- Focused protocol tests pass, for example:
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts src/modules/mcp-server/server.test.ts`.
- A fixture or transcript shows a long-running MCP request with a
  `progressToken`, one or more accepted `notifications/progress` updates, a
  final result, and no progress mutation after completion.
- A negative fixture shows unknown-token, non-monotonic, and post-cancel
  progress notifications being ignored or warned without changing the final
  tool result.
