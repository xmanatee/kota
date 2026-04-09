---
id: task-consolidate-operator-cli-into-extensions
title: Move operator-facing CLI commands to their contributing extensions
status: done
priority: p2
area: architecture
summary: Approval, memory, knowledge, audit, and task CLI commands are implemented in src/ root files instead of being colocated with their extensions. Consolidating them into the extensions that own the underlying stores would clarify ownership and reduce core bloat.
created_at: 2026-04-09T06:30:00Z
updated_at: 2026-04-09T07:00:00Z
---

## Problem

KOTA's core contains multiple CLI command files (`approval-cli.ts`, `memory-cli.ts`, `knowledge-cli.ts`,
`audit-cli.ts`, `task-cli.ts`) that are logically owned by their corresponding extensions (memory,
knowledge, approval-queue, guardrails-audit, repo-tasks). This scatters ownership: each extension
is responsible for runtime state and tool behavior, but the operator CLI surface lives in the core.

The pattern is inconsistent with how other extensions handle commands. For example, the `daemon` and
`web` extensions contribute their own CLI commands. The consistency violation creates friction when
understanding what an extension owns and increases cognitive overhead when making changes.

## Desired Outcome

Each operator-facing CLI command moves into its owning extension:

- `approval-cli.ts` → `src/extensions/approval-queue/cli.ts` (new extension)
- `memory-cli.ts` → `src/extensions/memory/cli.ts`
- `knowledge-cli.ts` → `src/extensions/knowledge/cli.ts`
- `audit-cli.ts` → `src/extensions/guardrails-audit/cli.ts` (new extension)
- `task-cli.ts` → `src/extensions/repo-tasks/cli.ts` (new extension)

Extensions register their CLI commands via `KotaExtension.onLoad(ctx)` using a new convention:
`ctx.registerCliCommands(name, commands)` or extensions call `registerApprovalCommands(program)`
directly from their `onLoad` as they already do for other registrations.

The CLI scaffold (`src/cli.ts`) imports from these extensions' export points rather than from
scattered root files. No public API change; operator experience is unchanged.

## Constraints

- No change to command signatures or behavior; this is refactoring only.
- Extensions must load in the CLI context, not just the daemon context.
- All tests must pass; test files move alongside implementation.
- `src/cli.ts` continues to be the CLI entry point; it just loads commands from extensions.

## Done When

- `approval-cli.ts`, `memory-cli.ts`, `knowledge-cli.ts`, `audit-cli.ts`, `task-cli.ts` are removed from `src/`.
- Each command's tests are colocated in the extension directory.
- `src/cli.ts` loads all commands from their extensions.
- `kota approval`, `kota memory`, `kota knowledge`, `kota audit`, and `kota task` commands all work
  unchanged.
- All existing CLI tests pass.

