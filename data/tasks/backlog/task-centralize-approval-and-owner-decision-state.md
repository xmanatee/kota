---
id: task-centralize-approval-and-owner-decision-state
title: Centralize approval and owner decision state
status: backlog
priority: p1
area: decisions
summary: Track separate approval and owner-decision lifecycle ownership migrations.
task_class: Safety
anchor: true
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Outcome

`approval-queue` and `owner-decisions` each own their durable transition semantics. Workflows, routes, CLI, MCP, and channels are thin identity, wire, rendering, or delivery adapters.

## Tracked Slices

- [ ] task-centralize-approval-lifecycle-state
- [ ] task-centralize-owner-decision-lifecycle-state

## Done When

Both slices are complete with authorization, expiry, replay resistance, revision binding, receipts, recovery, resume authority, and provenance preserved.

## Initiative

Lean behavioral verification: one security-sensitive state owner per lifecycle.
