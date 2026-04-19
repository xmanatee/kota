---
id: task-build-an-outcome-eval-harness-for-autonomy-workflo
title: Build an outcome-eval harness for autonomy workflow runs
status: backlog
priority: p2
area: autonomy
summary: KOTA has rich autonomy workflow infrastructure but no benchmark that scores whether runs actually advance repo state correctly across a fixture set; introduce a SWE-bench-style harness that scores autonomy roles against tagged fixture tasks so regressions become visible.
created_at: 2026-04-19T22:17:24.625Z
updated_at: 2026-04-19T22:17:24.625Z
---

## Problem

KOTA's autonomy modules ship a mature workflow runtime (recovery,
classification, retry, autonomy modes, telemetry) and the autonomous loop
operates on this repository continuously. None of that infrastructure is
actually scored end-to-end: there is no harness that asks "given a fixture
task, does an autonomy role land a correct outcome?" The only end-to-end
checks today are `verify-loop.integration.test.ts`,
`delegate-verify.integration.test.ts`, and the external-project autonomy
fixture test — they cover process plumbing, not outcome quality.

Peer projects make this measurement explicit. SWE-bench scores patch
correctness against real GitHub issues with a Docker-reproducible harness
that takes structured predictions and emits standardized results.
SWE-agent and OpenHands publish numbers against it (OpenHands at 77.6%).
Anthropic's "Quantifying infrastructure noise in agentic coding evals"
documents that infra configuration can dominate the gap between models on
those benchmarks — making the absence of any KOTA-side score doubly
risky: changes to harness, prompts, retries, or guardrails can silently
regress autonomy quality and we will not know.

## Desired Outcome

- A KOTA-owned eval harness that takes a tagged fixture set (each fixture
  describes an initial repo state, an autonomy role to invoke, and a
  pass/fail predicate over the resulting repo state) and produces a
  structured score per fixture and an aggregate per role.
- The harness runs each fixture in an isolated worktree (no
  cross-contamination, no impact on the operator's repo) and captures
  enough run artifacts to debug a regression after the fact.
- Results live as run artifacts; trends live in the existing telemetry
  surface. No second metrics store.
- Initial coverage: at least the heaviest autonomy roles
  (decomposer/builder/improver) get a small but real fixture set.
- A documented way to add a fixture and to interpret a regression so
  future autonomy changes can be gated on harness movement.

## Constraints

- Module-first: the harness lives in a dedicated module
  (e.g. `src/modules/eval-harness/`), not in core. Core stays
  protocol-oriented.
- Reuse the existing workflow runtime, autonomy modes, run store, and
  guardrails. Do not fork a parallel runtime just for evaluation.
- Fixtures must be honest: a "pass" predicate has to inspect actual repo
  state (build/test/lint/file content), not the agent's self-report.
- Do not add a test-only production flag to make the harness easy. The
  harness is an external module driving normal workflows.
- Cost and latency budgets per fixture run must be explicit; the harness
  is not allowed to wedge on a single hung agent step.
- Do not ship SWE-bench fixtures themselves — start with KOTA-shaped
  fixtures relevant to repo work the autonomy actually performs.
- No cost signals leak into agent-facing context (existing rule).

## Done When

- A new module owns the harness with a CLI entry point and an HTTP route
  that operators can use to run a fixture or fixture set against the
  current daemon configuration.
- A small initial fixture set exists, each fixture with a deterministic
  pass/fail predicate, and CI (or a dedicated workflow) runs the set on
  a defined cadence.
- Per-fixture results land as run artifacts; aggregate scores surface
  through the existing telemetry surface, not a new metrics store.
- A short note in the module's `AGENTS.md` describes how to add a
  fixture, how to read a regression, and how the harness participates
  in the autonomy lifecycle.
- The blocked CLI banner work and the multi-project work continue to
  function with the harness present (no runtime regressions).
