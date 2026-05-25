---
id: task-persist-remote-mcp-task-handles-for-crash-resume
title: Persist remote MCP task handles for crash resume
status: ready
priority: p2
area: core
summary: Add a core-side persistence path for remote MCP Tasks extension handles so task-backed external tool calls can resume after process restart instead of only recording completed-attempt diagnostics.
created_at: 2026-05-25T13:14:32.000Z
updated_at: 2026-05-25T14:18:02Z
---

## Problem

The external MCP client can now consume `resultType: "task"` responses during a
live tool call and records non-payload task diagnostics on the returned tool
result. That is enough for operator diagnosis of completed attempts, but it is
not a full crash-resume store: if KOTA exits after receiving a remote `taskId`
and before terminal completion, the live polling state is lost.

## Desired Outcome

Remote MCP task handles created by external `tools/call` requests are persisted
in a core-owned client-side store with enough information to resume polling
after reconnecting to the same remote server.

## Constraints

- Keep this in `src/core/mcp/`; do not import or reuse the first-party
  `mcp-server` module's task store.
- Store remote handles and polling diagnostics only. Do not store bearer
  tokens, authorization headers, input-response content, or remote task payload
  bodies.
- Preserve the existing live-polling behavior and result metadata added by
  `task-consume-mcp-tasks-extension-results-in-the-externa`.
- Treat reconnect ambiguity explicitly. If a server cannot be matched safely,
  surface an operator-visible diagnostic instead of polling the wrong remote
  task.

## Done When

- Remote task handles from task-backed external MCP tool calls are written to a
  core-owned persistence unit before polling begins.
- Startup or reconnect can resume polling unfinished handles for the same
  configured server and surface the terminal result or a safe diagnostic.
- Terminal, failed, cancelled, expired, and input-required states update or
  clear the persisted handle without leaking remote payload or operator input.
- Focused tests cover crash-before-terminal, reconnect resume, missing server,
  failed/cancelled terminal states, and redaction.

## Source / Intent

Follow-up from `task-consume-mcp-tasks-extension-results-in-the-externa`: that
task implemented live remote task consumption and result diagnostics but left
full crash-resume persistence as an explicit storage limitation.

## Initiative

MCP client crash resilience: external task-backed tool calls should retain
enough core-owned state to survive daemon restarts without duplicating the
first-party MCP server task store or leaking remote payload data.

## Acceptance Evidence

- Focused MCP client/manager persistence tests pass.
- A run artifact or fixture shows a persisted remote task handle surviving a
  simulated restart and resolving through `tasks/get`.
