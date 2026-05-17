---
id: task-add-objective-metric-reporting-to-eval-fixtures
title: Add objective-metric reporting to eval fixtures
status: ready
priority: p2
area: eval-harness
summary: Let eval-harness fixtures record deterministic numeric objective metrics in run artifacts while preserving pass/fail gating, so optimization-shaped tasks can prove measurable improvement without a parallel benchmark system.
created_at: 2026-05-17T13:04:31.000Z
updated_at: 2026-05-17T13:04:31.000Z
---

## Problem

KOTA's eval harness is strong at pass/fail workflow regression gates, but
optimization-shaped work has no first-class place to record the measurable
objective it improved. A task can currently prove that tests pass, but not
that a deterministic objective such as runtime, output size, memory use, error
rate, or heuristic quality improved by the claimed amount. That makes
optimization tasks easy to over-claim and hard for operators or improver to
compare across runs.

## Desired Outcome

Eval fixtures can declare one or more deterministic numeric objective metrics,
evaluate them during fixture execution, and emit the observed values in the
per-run and aggregate artifacts. The metrics make optimization results
inspectable while the existing pass/fail predicate contract remains the only
regression gate.

## Constraints

- Do not add a parallel benchmark runner, metrics store, or workflow DSL. Use
  the existing eval-harness fixture, runner, predicate, and artifact surfaces.
- Keep regression gating on pass/fail and `pass^k`; objective metrics are
  reported evidence unless a fixture explicitly has a deterministic predicate
  that turns a metric threshold into pass/fail.
- Objective values must be produced by deterministic code, fixture files, or
  runtime artifacts, never by agent self-report.
- Preserve the existing resource-profile and execution-profile comparability
  rules so metric deltas are not compared across incompatible environments.
- Keep cost signals operator-facing only; do not turn cost into an
  autonomy-facing optimization objective.

## Done When

- The fixture schema accepts a typed objective-metric declaration with a name,
  unit, direction (`lower_is_better` or `higher_is_better`), extraction source,
  and optional comparison baseline.
- Fixture runs evaluate declared metrics and write them to per-run artifacts
  and aggregate reports with enough context to compare repeated runs on the
  same resource profile.
- At least one shipped smoke fixture demonstrates the feature with a
  deterministic local metric and an explicit pre-run expectation proving the
  metric is not vacuous.
- A fixture that declares malformed, missing, nonnumeric, or environment-
  incomparable objective data fails loudly with a typed validation error.
- Existing pass/fail fixture scoring and cadence baseline behavior remain
  unchanged unless a fixture author intentionally adds a metric-threshold
  predicate.

## Source / Intent

Explorer refresh on 2026-05-17 revisited the DeepMind watchlist entry. The
May 7, 2026 AlphaEvolve update describes a Gemini-powered coding agent used
for algorithm discovery and production optimization, with reported objective
improvements across genomics, power-grid feasibility, infrastructure
heuristics, compiler output, and model/runtime efficiency:
https://deepmind.google/blog/alphaevolve-impact/

The KOTA-relevant lesson is not to import an evolutionary agent framework. It
is that optimization work needs explicit objective evidence, and KOTA's
existing eval-harness artifacts are the right place to carry that evidence.

## Initiative

Outcome-grade autonomy evaluation: KOTA should make measurable optimization
claims inspectable through the existing eval-harness path without weakening the
pass/fail regression gate or adding a second benchmark system.

## Acceptance Evidence

- `pnpm test src/modules/eval-harness` covers schema validation, metric
  extraction, malformed metric failures, and unchanged pass/fail aggregation.
- A `pnpm kota eval run ...` transcript or checked fixture artifact shows a
  fixture run emitting at least one objective metric in both per-run and
  aggregate output.
- The task's implementation notes or run artifact show that a metric delta is
  not compared when resource or execution profiles are incompatible.
