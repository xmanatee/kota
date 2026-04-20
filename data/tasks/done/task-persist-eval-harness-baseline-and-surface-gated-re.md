---
id: task-persist-eval-harness-baseline-and-surface-gated-re
title: Persist eval-harness baseline and surface gated regressions through attention-digest
status: done
priority: p1
area: autonomy
summary: The weekly eval-harness cadence emits aggregate pass@k/pass^k but nothing compares it to a prior baseline, nothing gates on regression, and no operator-facing surface sees the result; a drop in pass^k is invisible to operators today.
created_at: 2026-04-20T10:24:47.959Z
updated_at: 2026-04-20T11:13:54.089Z
---

## Problem

The eval-harness cadence workflow runs weekly, writes `ran-at.json`, and
emits `eval-harness.set.completed` on the event bus. The harness knows how to
compute a `regression-gate` decision against a baseline (see
`src/modules/eval-harness/noise-band.ts` and the `Regression Gate Threshold`
rule in the module's `AGENTS.md`), but the cadence workflow never materializes
a baseline or runs the comparison. Every run is stand-alone. Worse, nothing
subscribes to `eval-harness.set.completed` — grep shows the event is emitted,
tested, and typed, but has no consumer. A real regression would ship silently.

This is the "eval that nobody reads" anti-pattern the harness was introduced
to prevent, and it undermines the module's own `pass^k` gating contract.

## Desired Outcome

- The cadence workflow resolves the last accepted baseline (aggregate pass@k,
  pass^k, k, and resource profile from the prior cadence run) from a stable
  on-disk location, then runs the built-in gate using that baseline against
  the fresh aggregate.
- When the gate decides `gated`, a typed regression event fires on the bus
  (distinct from `set.completed`, carrying at minimum the baseline and
  candidate aggregates, the noise band, the host class, the run-artifact
  directory, and the gate `reason`).
- Attention-digest (or the most fitting existing observer) consumes that
  regression event and surfaces it through the normal attention channel so an
  operator actually sees a regression without opening run artifacts.
- On `not-gated` outcomes the baseline is updated for the next comparison; on
  `gated` outcomes the baseline is held and the previous one remains the next
  comparison point until the regression is acknowledged.
- The persisted baseline lives under `.kota/` (or the project's normal runtime
  state directory) so it is scoped to one project and survives daemon restart
  — it is not checked into the repo.

## Constraints

- Ownership stays inside the `eval-harness` module. Do not scatter baseline
  logic into core or into autonomy workflows unrelated to evaluation.
- Reuse the existing gate logic in `noise-band.ts`. Do not reimplement the
  noise band, the `resource-profile-drift` check, or the
  `repeat-count-below-minimum` check.
- Use semantic bus events, not workflow-name routing. The regression consumer
  subscribes to a typed event that describes the state change; it does not
  branch on the producer workflow's name.
- Do not leak cost signals into any agent-facing prompt or step. Regression
  surfaces carry `pass@k`, `pass^k`, and resource profile — not token or
  dollar cost.
- Do not add a parallel metrics store. Historical baselines are the one
  cross-run piece of state this introduces; anything else continues to live
  as run artifacts and bus events.
- Keep the CLI and HTTP entry points unchanged in behavior when a caller
  passes an explicit baseline on the command/request — only the cadence
  workflow auto-resolves a persisted baseline.

## Done When

- A persistence primitive for the accepted baseline exists in the
  `eval-harness` module, scoped per project, with typed read/write and a
  clear "no prior baseline" case that the cadence handles explicitly
  (first run records a baseline but does not gate).
- The cadence workflow loads the prior baseline, runs the existing gate, and
  records the gate decision and `reason` in `ran-at.json` alongside the
  aggregates.
- A typed regression event (name described in the module's `AGENTS.md`,
  not in this task) fires only on `gated` decisions; `not-gated` does not
  emit a regression event.
- At least one operator-facing surface — attention-digest by default, unless
  routing review prefers a different observer — consumes the regression
  event and produces a visible operator signal end-to-end.
- Tests cover: first-run (no baseline) behavior, gated regression on a
  synthetic aggregate drop, not-gated outcome with baseline update, and
  resource-profile-drift + repeat-count-below-minimum both resolving to
  non-gated with the correct reason.
- The `eval-harness` module's `AGENTS.md` states how baseline persistence
  works at the conventions level (what it stores, when it rolls forward,
  where it lives), without enumerating file names or event payload fields.
