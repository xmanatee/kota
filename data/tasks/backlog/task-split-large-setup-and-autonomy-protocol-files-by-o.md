---
id: task-split-large-setup-and-autonomy-protocol-files-by-o
title: Split large setup and autonomy protocol files by ownership
status: backlog
priority: p2
area: architecture
summary: Refactor oversized setup, batching, and autonomy workflow files into smaller ownership-aligned modules before more features depend on them.
created_at: 2026-06-04T13:06:44.528Z
updated_at: 2026-06-04T13:06:44.528Z
---

## Problem

Several new files now own critical protocols but are large enough to make
review, extension, and invariant placement harder:

- `src/core/modules/setup-requirements.ts` — 1106 lines.
- `src/modules/autonomy/workflows/progress-reviewer/progress-review.ts` — 1326 lines.
- `src/modules/autonomy/workflows/progress-reviewer/workflow.ts` — 386 lines.
- `src/core/workflow/event-batches.ts` — 393 lines.

These are exactly the surfaces where the owner values simple contracts,
separation of concerns, and verifiable invariants. Leaving storage, validation,
status derivation, evidence collection, mutation, and workflow composition in
large mixed files makes it more likely that future protocol work adds another
parallel mechanism or misses an invariant.

## Desired Outcome

Refactor the oversized files into ownership-aligned modules without changing
behavior. The split should make each protocol boundary easier to inspect and
test:

- Setup/auth: declarations and runtime validation, action lifecycle store,
  status derivation, config/secret mutation, and service facade.
- Progress-reviewer: target selection, evidence collection, artifact scanning,
  review output handling, task/question mutation, and workflow definition.
- Event batching: trigger config validation, durable buffer store, flush
  scheduling, overflow policy, and batch payload construction.

## Constraints

- Preserve behavior and public contracts unless a bug-fix task explicitly owns
  the behavior change.
- Do not introduce a second setup store, event batching engine, or progress
  reviewer.
- Keep imports through existing `#core/*` and `#modules/*` aliases where the
  dependency crosses directories.
- Do not compensate with more docs; the refactor should make code ownership
  clearer by structure and tests.

## Done When

- The named files are split below the repo's approximate 300-line TypeScript
  guideline, or any remaining exception is narrow and justified by cohesion.
- Existing tests for setup requirements, event batching, progress-reviewer, and
  workflow critical paths pass unchanged or with focused fixture updates.
- Local `AGENTS.md` files remain concise and accurately describe the new
  ownership boundaries.
- `pnpm run typecheck`, `pnpm run lint`, and focused workflow/setup tests pass.

## Source / Intent

Architecture re-review on 2026-06-04. The owner asked for simple, clean
contracts, separation of concerns, no duplication, and no overengineering while
the daemon is adding scopes, workflows, setup/auth, batching, and review loops.

## Initiative

Core protocol maintainability.

## Acceptance Evidence

- Diff showing behavior-preserving splits with no new public concepts.
- Focused test output for setup requirements, event batching, progress-reviewer,
  scope-improver, and workflow-critical paths.
