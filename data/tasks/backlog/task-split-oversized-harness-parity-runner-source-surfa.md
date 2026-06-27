---
id: task-split-oversized-harness-parity-runner-source-surfa
title: Split oversized harness-parity runner source surface
status: backlog
priority: p3
area: modules
summary: Builder run 2026-06-27T00-33-10-684Z-builder-wtiy1i left an untracked source-file-size advisory for src/modules/harness-parity/runner.ts at 1777 lines after a touched change. Split cohesive runner helpers or record a narrow source-size cleanup exception so future harness-parity edits do not leave the same warning untracked.
created_at: 2026-06-27T03:17:44.373Z
updated_at: 2026-06-27T03:17:44.373Z
---

## Problem

Builder run 2026-06-27T00-33-10-684Z-builder-wtiy1i recorded a source-file-size advisory for `src/modules/harness-parity/runner.ts`: 1,777 lines, 300-line threshold, and 4 changed lines. The follow-up monitor-warning task addressed the daemon-client stub warning but did not split, except, or otherwise track the still-oversized runner surface.

## Desired Outcome

`src/modules/harness-parity/runner.ts` is split into cohesive harness-parity helpers so routine runner changes no longer produce an untracked source-size advisory. If a final residual exception is needed, it must be a narrow source-size cleanup exception with before/after line-count evidence.

## Constraints

- Preserve harness-parity runner behavior and artifact shape.
- Keep scenario execution on the existing `runAgentHarness` path; do not add a second benchmarking or runner framework.
- Keep extracted helpers under the harness-parity module boundary.
- Do not remove or weaken trajectory, context-retrieval, diff, verification, staged-run, or preview artifact capture.

## Done When

- The runner surface is split or reduced so staged source-size diagnostics no longer warn for changed harness-parity runner files, or a typed source-size cleanup exception is recorded with evidence that every cited file is smaller than before.
- Before/after line counts are recorded in the task or run artifact.
- Focused harness-parity runner/model-matrix tests pass, plus typecheck and task validation.

## Source / Intent

Created from builder repair run 2026-06-27T03-03-16-056Z-builder-18hkkb after critic review found that `data/tasks/done/task-resolve-model-matrix-builder-monitor-warnings.md` did not track the original source-size advisory for `src/modules/harness-parity/runner.ts`.

Evidence ids:

- run:2026-06-27T00-33-10-684Z-builder-wtiy1i
- artifact:.kota/runs/2026-06-27T00-33-10-684Z-builder-wtiy1i/steps/build.json
- task:task-resolve-model-matrix-builder-monitor-warnings

## Initiative

N/A - scoped maintenance

## Acceptance Evidence

- Before/after line counts for `src/modules/harness-parity/runner.ts` and any extracted helper files.
- Staged source-size diagnostics report no unhandled warnings for changed harness-parity runner files, or the task records a valid typed source-size cleanup exception.
- Focused validation passes: harness-parity runner/model-matrix tests, `pnpm typecheck`, and `pnpm run validate-tasks`.
