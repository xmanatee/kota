---
id: task-add-control-decision-coverage-metadata-to-eval-fix
title: Add control-decision coverage metadata to eval fixtures
status: ready
priority: p2
area: modules
summary: Classify eval-harness fixtures by typed control-decision coverage and surface the coverage in eval reports so future evaluation work targets real behavioral gaps instead of duplicating outcome-only fixtures.
created_at: 2026-05-27T02:21:25.812Z
updated_at: 2026-05-27T02:21:25.812Z
---

## Problem

KOTA's eval harness now records pass/fail, pass@k/pass^k, objective metrics,
resource profiles, trajectory diagnostics, and replay provenance. Those are
strong outcome and process signals, but the fixture set still has no typed way
to say which agent control decision each fixture actually exercises: acting,
asking, refusing unsafe work, stopping/no-oping, confirming with an operator, or
recovering after failure.

That makes coverage drift hard to see. A future explorer can look at a thin
queue and keep adding new benchmark-shaped tasks even when the real gap is
clearer: KOTA needs a machine-readable coverage view over the fixtures it
already ships, so evaluation work targets missing behavior instead of
duplicating outcome-only pass/fail surfaces.

## Desired Outcome

Eval-harness fixtures declare a small, typed control-decision coverage set, and
the normal eval surfaces expose aggregate coverage without turning it into a
parallel benchmark or docs catalog.

Use a KOTA-owned enum that maps cleanly onto current workflow behavior, for
example:

- `act` - the agent should make a substantive code/data change.
- `ask` - the correct path is to request owner/operator input.
- `refuse` - the correct path is to reject or avoid unauthorized work.
- `stop` - the correct path is no-op / already satisfied / do not patch.
- `confirm` - the correct path is to wait for an explicit approval or
  confirmation boundary.
- `recover` - the correct path is recovery after failure, timeout, dirty state,
  or interrupted work.

Every shipped fixture should declare at least one decision. `pnpm kota eval
list`, `eval-set-report.json`, and the daemon control route should show compact
coverage counts and missing-decision warnings so operators can see what the
fixture set does and does not cover.

## Constraints

- Keep this in `src/modules/eval-harness/`; do not add a second eval registry,
  benchmark catalog, or durable docs inventory of every fixture.
- Make the coverage field typed and loader-validated. Internal malformed fixture
  metadata should fail loudly with a fixture path and field name.
- Prefer a required field on every fixture over optional fallback inference.
  Absence is not a domain state; it means the fixture contract is incomplete.
- Do not let coverage labels affect pass/fail scoring, regression gating,
  objective metrics, or resource-profile eligibility in this slice. Coverage is
  diagnostic planning metadata unless a later task explicitly adds a gate.
- Keep exact enum names and output shapes in source types and focused tests, not
  broad docs prose.
- Do not import AgentAtlas's benchmark or taxonomy wholesale. The external
  signal is the need for control-decision coverage visibility; KOTA owns the
  local vocabulary.

## Done When

- `FixtureSpecFile` has a required typed control-decision coverage field, with
  loader validation for non-empty arrays, legal enum values, and duplicate
  labels.
- Every shipped fixture's `fixture.json` declares its control-decision coverage.
- The eval-list operation/CLI exposes coverage counts and missing-decision
  warnings while preserving existing fixture details and JSON/scriptable output.
- `runEvalSet` persists the same coverage aggregate into `eval-set-report.json`
  without changing scoring semantics.
- The daemon eval control route returns the coverage summary through the typed
  eval list/report surface.
- Focused tests cover loader failures, all shipped fixtures loading with
  coverage, list/report aggregation, and at least one deliberately missing
  decision warning.

## Source / Intent

Explorer run `2026-05-27T02-18-56-126Z-explorer-5v2c1h` reviewed a queue with
zero actionable ready/doing tasks and seven strategic blocked alternatives. All
strategic alternatives were real operator-capture waits and not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://arxiv.org/abs/2605.20530` (AgentAtlas, submitted May 19, 2026)
  argues that deployable agent evaluation needs more than outcome leaderboards
  and highlights control-decision coverage (`Act / Ask / Refuse / Stop /
  Confirm / Recover`) plus trajectory-failure diagnosis and benchmark-coverage
  audits.

KOTA already has trajectory diagnostics from AgentLens, no-op restraint from
FixedBench, scope restraint from OverEager, objective metrics from ERA-style
optimization work, and black-box behavior reconstruction from ProgramBench. The
nonduplicative gap is not another imported benchmark. It is a typed local
coverage layer that lets KOTA see which control-decision behaviors the existing
fixtures exercise.

## Initiative

Outcome-grade autonomy evaluation: KOTA should be able to inspect its eval
coverage by behavioral role, not only by final outcome, so future fixture work
targets missing autonomy behaviors with less duplicate benchmark churn.

## Acceptance Evidence

- Transcript under `.kota/runs/<run-id>/` for
  `pnpm test src/modules/eval-harness/fixture.test.ts src/modules/eval-harness/eval-set.test.ts src/modules/eval-harness/cli.test.ts src/modules/eval-harness/eval-control-routes.test.ts`
  or the narrower focused files that own the implemented coverage surface.
- Transcript under `.kota/runs/<run-id>/` for `pnpm kota eval list --json`
  showing fixture control-decision coverage in machine-readable output.
- A sample `eval-set-report.json` under `.kota/runs/<run-id>/` showing the
  persisted coverage aggregate beside the existing scoring/objective-metric
  fields.
