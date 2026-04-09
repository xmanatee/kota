---
id: task-create-approval-queue-extension
title: Create dedicated approval-queue extension to own approval state and CLI
status: ready
priority: p2
area: architecture
summary: The approval queue is currently core logic in approval-queue.ts and approval-cli.ts. Creating a dedicated extension would consolidate ownership and follow the pattern of other state-owning extensions like memory and knowledge.
created_at: 2026-04-09T06:32:00Z
updated_at: 2026-04-09T06:32:00Z
---

## Problem

The approval queue is a critical runtime state subsystem but lives split between core files:
`approval-queue.ts` (state management), `approval-cli.ts` (operator CLI), and scattered references
in the loop and tool runner. This violates the extension-first pattern established by memory and
knowledge extensions which own their own state, CLI, and lifecycle.

## Desired Outcome

A new `src/extensions/approval-queue/` extension that:

- Owns `ApprovalQueue` class and singleton accessors
- Owns `registerApprovalCommands` and all `kota approval` subcommands
- Registers the `enable_approvals` workflow step that gates tool execution based on approval status
- Is loaded early (topologically) so tool-runner and other subsystems can depend on it
- Follows the same lifecycle pattern as memory and knowledge extensions

The core loop and tool-runner import approval logic from the extension rather than from scattered
root files. No behavior change; this is pure refactoring.

## Constraints

- No API changes to approval behavior or command signatures.
- The extension must load before tool-runner tries to use approvals.
- All existing approval workflows and tests must work unchanged.

## Done When

- `src/extensions/approval-queue/` exists with full implementation.
- `approval-queue.ts` and `approval-cli.ts` are removed from `src/`.
- Core files that use approval logic import from the extension.
- `kota approval` commands work unchanged.
- All approval-related tests pass.

