---
id: task-create-approval-queue-extension
title: Complete approval-queue extension to own approval state (CLI already migrated)
status: done
priority: p2
area: architecture
summary: src/extensions/approval-queue/ exists with CLI commands. The remaining work is migrating approval state (ApprovalQueue class, singleton accessors) from src/approval-queue.ts into the extension so core tool-runner imports from the extension instead of a core file.
created_at: 2026-04-09T06:32:00Z
updated_at: 2026-04-09T05:45:00Z
---

## Problem

`src/approval-queue.ts` still owns the `ApprovalQueue` class and singleton accessors in core, even though the CLI commands have already moved to `src/extensions/approval-queue/`. This violates the extension ownership boundary: approval state should be fully owned by the extension, not split between core and the extension directory.

## Current State

`src/extensions/approval-queue/` exists with `cli.ts` (all `kota approval` subcommands) and
`index.ts` (extension module). `approval-cli.ts` has been removed from `src/`. The CLI half of
the migration is complete.

The remaining gap: `src/approval-queue.ts` (ApprovalQueue class, singleton accessors, PendingApproval
type) still lives in core. Tool-runner, the loop, and other subsystems import directly from there.

## Desired Outcome

Complete the extension so it fully owns the approval subsystem:

- Move `ApprovalQueue` class and singleton accessors into the extension
- Export `PendingApproval`, `ApprovalStatus`, and related types from the extension
- Core tool-runner and loop import approval logic from the extension, not from `src/approval-queue.ts`
- The extension loads early (topologically) so tool-runner can depend on it
- Follows the same lifecycle pattern as memory and knowledge extensions

No behavior change; this is pure refactoring.

## Constraints

- No API changes to approval behavior or command signatures.
- The extension must load before tool-runner tries to use approvals.
- All existing approval workflows and tests must work unchanged.

## Done When

- `src/approval-queue.ts` is removed from `src/`.
- `src/extensions/approval-queue/` has full state + CLI implementation.
- Core files that use approval logic import from the extension.
- `kota approval` commands work unchanged.
- All approval-related tests pass.

