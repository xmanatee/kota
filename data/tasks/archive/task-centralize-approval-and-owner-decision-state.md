---
status: dropped
---

# Centralize approval and owner decision state

## Outcome

`approval-queue` and `owner-decisions` each own their durable transition semantics. Workflows, routes, CLI, MCP, and channels are thin identity, wire, rendering, or delivery adapters.

## Tracked Slices

- [ ] task-centralize-approval-lifecycle-state
- [ ] task-centralize-owner-decision-lifecycle-state

## Done When

Both slices are complete with authorization, expiry, replay resistance, revision binding, receipts, recovery, resume authority, and provenance preserved.

## Initiative

Lean behavioral verification: one security-sensitive state owner per lifecycle.

## Disposition

This strategic tracking record is retired because initiatives are not executable tasks. Its child tasks retain the actionable outcomes and dependency structure.
