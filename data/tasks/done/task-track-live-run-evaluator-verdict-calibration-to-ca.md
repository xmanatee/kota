---
id: task-track-live-run-evaluator-verdict-calibration-to-ca
title: Track live-run evaluator verdict calibration to catch silent generator/evaluator drift
status: done
priority: p2
area: autonomy
summary: Autonomy eval-harness scores fixtures but no live-run metric tracks how often critic verdicts align with downstream evidence; add a calibration signal so silent evaluator drift is visible to operators
created_at: 2026-04-20T12:24:24.279Z
updated_at: 2026-04-20T13:43:42.999Z
---

## Problem

The autonomy loop uses a generator/evaluator split: builder proposes a change,
critic emits a `pass | pass_with_warnings | fail` verdict, and the repair loop
reacts. The eval-harness module already scores fixed fixtures against known
outcomes, but nothing tracks how well the critic's verdicts hold up on **live
runs** against real downstream evidence. When the critic silently drifts —
approving changes the repair-loop then rejects, or that a follow-up run has to
fix — there is no operator-visible signal until a human notices a pattern
across many runs.

Recent KOTA autonomy decisions explicitly warn about this shape: diff-only
review is structurally blind for outcomes that live outside repo state, and
runaway judge invocations already burned budget before the classifier fix.
Both suggest the evaluator can go off-calibration without fixture scores
moving, because fixtures are a static benchmark, not a measurement of the
critic as deployed.

## Desired Outcome

- Each finished autonomy run records a calibration signal that compares the
  final critic verdict against downstream evidence already produced by the
  same run: repair-loop outcome (did any post-verdict check fail), whether
  the workflow reached `done` vs `dropped`/`blocked`, and whether a follow-up
  task landed against the same file path within a bounded window.
- An aggregate calibration score is derivable from run artifacts without
  per-run human annotation. Operators can see "critic pass rate vs
  repair-loop reject rate" and "critic pass-with-warnings vs follow-up
  fix rate" across a rolling window.
- When calibration drops below a threshold (critic pass verdicts contradicted
  by downstream evidence at some rate), the signal reaches the attention
  digest rather than being buried in `.kota/runs/`.
- The signal is additive to the existing eval-harness fixture cadence, not a
  replacement. Fixture regressions keep reporting through the existing gate.

## Constraints

- Work inside `autonomy` (or a small new co-located helper in
  `src/modules/autonomy/`) plus `eval-harness` for aggregate reporting. Do
  not add a parallel observability surface in core.
- Run artifacts are the source of truth. The calibration summary lives as a
  typed JSON artifact in each run directory; aggregation reads artifacts,
  never mutates them.
- Do not introduce per-task override flags, human-annotation steps, or
  synthetic fixtures just to compute calibration.
- Reuse existing run-outcome classification (`run-outcome-aggregation.ts`)
  and critic verdict parsing rather than inventing a parallel taxonomy.
- Respect the bus-event contract: if a regression fires, it rides the
  attention bus event, not a direct notification call.

## Done When

- Every builder run emits a typed `evaluator-calibration.json` artifact
  capturing the final verdict, the repair-loop outcome, the terminal run
  state, and any follow-up-task fingerprint within the bounded window.
- A CLI surface (likely `pnpm kota eval calibration`) summarizes calibration
  across a rolling window with a typed output schema covered by tests.
- A bus event fires when calibration falls below a configured threshold; the
  attention-digest workflow already consumes the event and surfaces it to
  the operator without per-consumer special-casing.
- Tests exercise: verdict-vs-repair-loop contradiction, verdict-vs-follow-up
  correlation, threshold-crossing event emission, and the CLI aggregation
  path against seeded artifacts.
- The autonomy module `AGENTS.md` gains a short decision note explaining
  calibration scope vs fixture scoring, so future contributors do not add a
  parallel signal.
