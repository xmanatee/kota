---
id: task-create-approval-queue-module
title: Complete approval-queue module to own approval state (CLI already migrated)
status: done
priority: p2
area: architecture
summary: src/modules/approval-queue/ exists with CLI commands. The remaining work is migrating approval state (ApprovalQueue class, singleton accessors) from src/approval-queue.ts into the module so core tool-runner imports from the module instead of a core file.
created_at: 2026-04-09T06:32:00Z
updated_at: 2026-04-09T05:45:00Z
---

## Problem

`src/approval-queue.ts` still owns the `ApprovalQueue` class and singleton accessors in core, even though the CLI commands have already moved to `src/modules/approval-queue/`. This violates the module ownership boundary: approval state should be fully owned by the module, not split between core and the module directory.

## Current State

`src/modules/approval-queue/` exists with `cli.ts` (all `kota approval` subcommands) and
`index.ts` (module module). `approval-cli.ts` has been removed from `src/`. The CLI half of
the migration is complete.

The remaining gap: `src/approval-queue.ts` (ApprovalQueue class, singleton accessors, PendingApproval
type) still lives in core. Tool-runner, the loop, and other subsystems import directly from there.

## Desired Outcome

Complete the module so it fully owns the approval subsystem:

- Move `ApprovalQueue` class and singleton accessors into the module
- Export `PendingApproval`, `ApprovalStatus`, and related types from the module
- Core tool-runner and loop import approval logic from the module, not from `src/approval-queue.ts`
- The module loads early (topologically) so tool-runner can depend on it
- Follows the same lifecycle pattern as memory and knowledge modules

No behavior change; this is pure refactoring.

## Constraints

- No API changes to approval behavior or command signatures.
- The module must load before tool-runner tries to use approvals.
- All existing approval workflows and tests must work unchanged.

## Done When

- `src/approval-queue.ts` is removed from `src/`.
- `src/modules/approval-queue/` has full state + CLI implementation.
- Core files that use approval logic import from the module.
- `kota approval` commands work unchanged.
- All approval-related tests pass.

