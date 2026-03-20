---
id: task-approval-queue-cli
title: Add kota approval CLI commands for operator queue management
status: ready
priority: p2
area: cli
summary: The approval queue routes dangerous tool calls for human review, but there is no CLI for operators to list, approve, or reject pending items. Add `kota approval list/approve/reject` so operators can act on the queue from the terminal.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`ApprovalQueue` stores dangerous tool calls under `.kota/approvals/` when the guardrails policy is "queue". The only way to review and resolve these today is through the `approval` agent tool (accessible in interactive REPL sessions). Operators running KOTA autonomously have no terminal interface to inspect or act on the queue — they would have to parse raw JSON files manually.

## Desired Outcome

- `kota approval list` — shows all pending items with id, tool name, input summary, risk level, and reason
- `kota approval approve <id>` — approves and executes the queued tool call; prints the result
- `kota approval reject <id> [--reason <text>]` — rejects the queued item
- `kota approval count` — prints the number of pending items (useful for scripting/monitoring)

## Constraints

- Read from the same `ApprovalQueue` class (`src/approval-queue.ts`); do not build parallel file-reading logic
- `approve` executes the tool call immediately via `executeTool` (same as the agent approval tool does)
- Register the new commands under the existing `program` in `src/cli.ts` following the pattern of `registerWorkflowCommands` and `registerHistoryCommands`
- `kota approval approve` requires the daemon to be running if the tool needs its context; document this if relevant

## Done When

- `kota approval list` shows pending items
- `kota approval approve <id>` approves and executes a queued item
- `kota approval reject <id>` rejects an item
- Tests cover list, approve, and reject command logic
