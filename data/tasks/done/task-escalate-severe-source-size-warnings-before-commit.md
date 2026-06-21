---
id: task-escalate-severe-source-size-warnings-before-commit
title: Escalate severe source-size warnings before commit
status: done
priority: p2
area: autonomy
task_class: Platform
summary: Turn calibrated source-file-size warnings into an adaptive builder gate for severe or repeated oversized-growth cases so large avoidable files are split during the originating run instead of spawning repeated cleanup tasks.
created_at: 2026-06-21T02:51:44.137Z
updated_at: 2026-06-21T03:07:36.000Z
---

## Problem

The changed-source-size guard is now visible, but it is still purely advisory.
That was correct for V1 calibration, yet the last few autonomy cycles show the
cost of leaving every warning nonblocking: broad Platform tasks can land with
seven or more `source-file-size` warnings, then progress-reviewer creates p3
cleanup tasks after the fact.

The current ready queue has one such cleanup:
`task-split-oversized-eval-harness-fixture-and-runner-fi`. It is valid
follow-up work, but it is also evidence that the guard has moved past the
"make warnings visible" phase. KOTA needs a calibrated escalation path that
keeps ordinary touched-legacy-file warnings advisory while blocking severe,
avoidable source growth inside the originating builder run.

## Desired Outcome

Make the builder repair loop treat severe source-size warning batches as
actionable before commit. The check should still avoid punishing unrelated
legacy debt, but it should fail loudly when a run touches too many oversized
source files, grows an already oversized file substantially, or repeats the
same warning pattern after a prior cleanup task already exists.

The failure must give the builder a clear route: split cohesive helpers in the
same task, narrow the implementation, or record a typed exception only when the
task itself is explicitly about a temporary source-size cleanup or another
validated large-file tradeoff.

## Constraints

- Build on `src/modules/autonomy/source-size-check.ts` and the existing
  builder repair-check wiring. Do not add a second source-size scanner.
- Preserve changed-file-only behavior. Untouched oversized files must not
  block unrelated builder runs.
- Preserve an advisory warning path for low-severity touches, such as a tiny
  edit to a legacy file that remains just over the 300-line guideline.
- Escalation thresholds must be deterministic and tested. Avoid agent-judged
  prose as the only reason a warning becomes blocking.
- Exceptions must be typed and auditable through existing task/run evidence,
  not free-form comments that silently bypass the guard.
- Keep source-size signals out of cost/model optimization. This is a
  maintainability gate, not a prompt-cost policy.

## Done When

- The builder repair loop distinguishes advisory source-size warnings from
  blocking severe source-size failures.
- Severe cases include at least a multi-file oversized batch and an oversized
  file with substantial positive growth; focused tests define exact thresholds.
- A normal tiny edit to one legacy oversized source file remains a warning and
  records the same `source-file-size` artifact shape as today.
- A task explicitly scoped as source-size cleanup can pass when it reduces the
  named warning set, even if an intermediate touched file remains above the
  line guideline.
- Run summaries and repair-check output make the escalation reason visible:
  advisory warning, blocking severe batch, or typed exception.
- The existing p3 cleanup path remains valid for historical warnings, but new
  severe warning batches are caught before the originating builder commit.

## Result

The builder repair loop now has a blocking `source-file-size-severe` check in
front of the existing advisory `source-file-size` warning check. The shared
scanner still reports changed-file-only structured warnings, while
`source-size-escalation.ts` classifies severe batches, substantial positive
growth, and open cleanup-task overlaps with deterministic thresholds.

Typed cleanup exceptions are declared through a task-local
`## Source Size Exception` section with `kind: source-size-cleanup` and a
named file list. The exception only applies when every current source-size
warning is named by the task and the staged diff reduces those files, so it
does not silently bypass positive growth or unrelated warning files.

## Source / Intent

Explorer run `2026-06-21T02-31-43-083Z-explorer-pj1urj` received a thin queue
with only one p3 ready task and `inspect-queue.strategicReadyCoverageGap: true`.
The surfaced strategic blocked alternatives all still require operator-captured
evidence and were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

Runtime evidence checked:

- `.kota/runs/2026-06-21T00-47-06-643Z-builder-tcwbba/run-summary.json`
  shows the accepted-alternative verifier calibration task completed
  successfully but emitted seven `source-file-size` warnings across
  eval-harness fixture, runner, eval-set, and scoring files.
- `.kota/runs/2026-06-21T01-12-28-596Z-progress-reviewer-ejmfsf/steps/review-evidence.json`
  created `task-split-oversized-eval-harness-fixture-and-runner-fi` as a p3
  cleanup because those warnings were not covered by the existing
  eval-attribution split.

Local overlap check:

- `task-visible-changed-source-size-guard` already added changed-file-only
  advisory warnings. This task is the calibrated V2 escalation path after
  warning volume became actionable.
- `task-split-oversized-eval-harness-fixture-and-runner-fi` remains the
  immediate cleanup for the current eval-harness files. This task prevents the
  same severe-warning shape from landing again as normal builder success.
- `scope-improver` already ingests oversized-source run evidence, but that acts
  after commit. This task changes the originating builder repair-loop behavior.

## Initiative

Autonomy maintainability and review hygiene: source-size warnings should guide
builders while the work is still in scope, not only generate trailing cleanup
tasks after large Platform changes have already landed.

## Acceptance Evidence

- Focused autonomy test transcript:
  `.kota/runs/2026-06-21T02-57-00-518Z-builder-ju6yyf/focused-autonomy-tests.txt`
  shows `src/modules/autonomy/source-size-check.test.ts`,
  `src/modules/autonomy/source-size-escalation.test.ts`,
  `src/modules/autonomy/workflows/builder/repair-checks.test.ts`, and
  `src/modules/autonomy/workflows/builder/workflow.test.ts` passing.
- The focused source-size tests cover advisory warning output, blocking
  oversized-batch threshold, blocking substantial-growth threshold, open
  cleanup-task overlap with sibling basenames, and typed cleanup-task exception
  output.
- Static validation transcript:
  `.kota/runs/2026-06-21T02-57-00-518Z-builder-ju6yyf/static-validation.txt`
  shows `pnpm run typecheck`, `pnpm run lint`, and `pnpm build` passing.
- Workflow validation transcript:
  `.kota/runs/2026-06-21T02-57-00-518Z-builder-ju6yyf/workflow-validate-node-import.txt`
  shows all workflow definitions valid. The direct `pnpm dev workflow validate`
  form is recorded separately as sandbox-blocked by `tsx` IPC permissions.
- Task validation transcript:
  `.kota/runs/2026-06-21T02-57-00-518Z-builder-ju6yyf/task-validation.txt`
  shows `pnpm run validate-tasks` passing after the final `git add -A` staged
  the fallback task move.
