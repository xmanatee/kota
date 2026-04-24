---
id: task-seed-eval-harness-fixtures-from-real-failure-runs-
title: Seed eval-harness fixtures from real-failure runs for workflows with no fixture coverage
status: done
priority: p2
area: autonomy
summary: Expand eval-harness coverage beyond builder/explorer/inbox-sorter by adding regression fixtures — each sourced from a concrete past failure run — for workflows currently without any fixture (decomposer, dispatcher, research-retry, pr-reviewer, improver, attention-digest, evaluator-calibration-*).
created_at: 2026-04-24T11:38:44.990Z
updated_at: 2026-04-24T11:56:12.115Z
---

## Problem

`src/modules/eval-harness/fixtures/` currently holds six fixtures and all
cluster on three workflows: builder (three fixtures), explorer
(`explorer-strategic-ready-trip`), and inbox-sorter (two). The remaining
project-shipped autonomy workflows — `decomposer`, `dispatcher`,
`research-retry`, `pr-reviewer`, `improver`, `attention-digest`,
`evaluator-calibration-monitor`, `evaluator-calibration-notify` — have zero
regression coverage at the harness layer. That means the harness can only
catch generator or evaluator drift for a narrow slice of the autonomy loop;
failures in the other workflows have to be caught live, burning an agent
re-run each time (the explorer case was ~15–25 minutes + ~$1.35–$1.77 per
trip before the fixture captured it).

`src/modules/autonomy/AGENTS.md` is explicit that harness fixtures must
come from real failures recorded under `.kota/runs/`, not synthetic tasks.
The gap is therefore two-sided: uncovered workflows *and* a growing backlog
of real-failure runs that could be converted into fixtures but have not
been.

## Desired Outcome

Every project-shipped autonomy workflow has at least one real-failure
fixture in `src/modules/eval-harness/fixtures/`, each carrying a typed
`provenance: { kind: "real-failure", sourceRunId: "..." }` that points at a
concrete past run where the failure mode actually manifested. The fixture's
predicate pass/fail signal mirrors the production check that caught the
failure live, so a future regression of the same shape trips the harness
instead of a live agent re-run. Fixtures are budget-bounded and run inside
the existing eval-harness `subprocess-executor.ts` path; no parallel
benchmarking framework is introduced.

## Constraints

- Every fixture must set `provenance.kind = "real-failure"` with a
  `sourceRunId` that exists under `.kota/runs/`. The loader already
  rejects any other shape without a `smoke` justification.
- Predicates stay small, deterministic, and artifact-based. They must
  inspect the final fixture working directory; never pass/fail on the
  agent's self-report. New predicate kinds extend the predicate union in
  `src/modules/eval-harness/predicates.ts`, not fixture-local hacks.
- Reuse the existing fixture layout (`fixture.json`, `initial/`,
  `notes.md`). `notes.md` records the source run id, the failure shape,
  and why the chosen predicate encodes that shape. The `AGENTS.md`
  fixture-provenance contract stays the single source of truth.
- Budgets and resource profile fields follow the harness's
  infrastructure-noise rule: explicit `budgetMs`, matching CPU/memory
  allocation vs kill thresholds, and k>=1 repeat index. A fixture that
  cannot realistically finish in CI's host class must declare that — do
  not silently loosen the band.
- Do not add fixtures for workflows whose failure mode cannot be reduced
  to a working-directory artifact. If a workflow's failure is only
  observable through bus events or notifications, seed a separate task
  to widen the predicate contract before adding the fixture; do not
  paper over it with an agent self-report predicate.
- Do not convert the existing repair-loop `src/modules/autonomy/...`
  checks into fixture predicates. The repair loop is the production gate;
  the fixture captures the same invariant at the harness layer as an
  independent regression witness.

## Done When

- Each of the uncovered workflows listed above either has at least one
  real-failure fixture under `src/modules/eval-harness/fixtures/`, or
  the task records in `notes.md` that no fixture is possible today and
  files a follow-up task to extend the predicate contract.
- Every new fixture's `sourceRunId` resolves to an actual run directory
  on the current branch, and the failure signal in that run is visible
  from the fixture's predicate when the fixture is replayed.
- `pnpm kota eval run` (or the equivalent harness CLI entry point) can
  exercise the new fixtures end-to-end on the default host class within
  the declared budgets.
- `src/modules/eval-harness/fixtures/AGENTS.md` (or the module's
  `AGENTS.md` if no fixtures-local file exists) still documents only
  the shape contract and provenance rule, not a per-fixture inventory.
