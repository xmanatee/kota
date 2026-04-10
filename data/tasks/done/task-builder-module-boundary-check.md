---
id: task-builder-module-boundary-check
title: Add module-boundary repair check to builder workflow
status: done
priority: p2
area: reliability
summary: The builder's repair loop validates code quality (typecheck, lint, test, build) but does not catch capability code that leaked into src/ root instead of a module. A check that detects new non-core TypeScript files in src/ would catch architectural regression before it commits.
created_at: 2026-04-10T08:00:00Z
updated_at: 2026-04-10T08:00:00Z
---

## Problem

The builder can commit new capability code directly into `src/` root without triggering any failure. The architecture explicitly requires new capabilities to live in `src/modules/<name>/`, not in the core `src/` root. Currently only the documentation and `AGENTS.md` guidance enforce this — there is no automated check in the build or repair loop.

As the module migration advances, new capability code added to `src/` root becomes invisible regression. By the time it is noticed, it may already be deeply depended on.

## Desired Outcome

The builder's `repairLoop` includes a check that:
1. Lists TypeScript files added to `src/` root (not `src/modules/`, `src/server/`, `src/scheduler/`, `src/workflow/`, `src/memory/`, `src/web-ui/`, or other established core subdirectories) by the current run.
2. Fails if a non-core `.ts` file appears directly under `src/` that is not in the established core file list.

The check should use `type: "code"` (not `tool: "shell"`) per the repair-loop guidance.

## Constraints

- The check must not flag files that are legitimately in `src/` root (existing core files like `loop.ts`, `config.ts`, `guardrails.ts`, etc.).
- It should detect only newly added files, not pre-existing ones.
- False positives are worse than false negatives — the check should be scoped to genuinely unexpected new root-level files.
- `type: "code"` with `spawnSync` or direct `readdirSync` — not `tool: "shell"`.

## Done When

- The builder `repairLoop` includes a `module-boundary` check.
- A test that adds a fake capability file to `src/` root and runs the check confirms it fails correctly.
- The check passes on the current clean codebase.
- Builder workflow tests pass.
