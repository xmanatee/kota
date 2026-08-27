---
status: done
---

# Report process-discipline scores from trajectory diagnostics

## Problem

KOTA now records trajectory-quality diagnostics for harness-parity runs and
ordinary workflow agent steps, and the operator report can stratify quality
signals by workflow, harness, task class, and area. Those pieces make weak
success shapes visible, but they remain scattered warning counts. An operator
comparing two presets, harnesses, or autonomy workflow windows still has to
manually infer whether one route is succeeding with disciplined planning,
verification, recovery, abstention, and atomic file transitions, or merely
passing with noisy process debt.

That is a safety and governance blind spot. If rollout decisions focus only on
final task success, KOTA can promote a cheaper model, a new harness path, or a
workflow change whose outcomes look acceptable while its process becomes less
inspectable, less recoverable, or more likely to leave unverified edits.

## Desired Outcome

Add a deterministic process-discipline projection over KOTA's existing
trajectory diagnostic artifacts. The first version should expose a compact,
versioned operator-facing score or grade for the supported dimensions below,
with explicit `unsupported` / `missing-evidence` states where local artifacts
cannot justify a dimension:

- planning fidelity: whether the trajectory shows task-relevant discovery
  before implementation rather than late blind editing;
- verification coverage: whether edits are followed by an appropriate final
  verification signal;
- recovery efficiency: whether failures lead to a changed approach instead of
  repeated identical failing commands;
- abstention quality: whether no-op, blocked, or unsupported paths are
  reported honestly instead of converted into gratuitous edits; and
- atomic transition integrity: whether the run avoids edit-after-pass,
  mixed-purpose churn, and post-verification changes without fresh evidence.

The score should be advisory evidence in run artifacts and `kota report`
output, not a new pass/fail gate. Operators should be able to compare recent
workflow or harness slices by outcome plus process discipline without opening
every per-step diagnostic file.

## Constraints

- Reuse existing `*.trajectory-diagnostics.json`, native agent message streams,
  run metadata, task metadata, and autonomy report aggregation. Do not import
  RigorBench, add a benchmark runner, mine external repositories, or add a
  separate metrics store.
- Keep the rubric deterministic and local. Do not add an LLM judge, scrape
  free-form transcript prose, or depend on provider-private traces.
- Treat unsupported evidence honestly. A missing planning or abstention signal
  should lower confidence or mark the dimension unsupported, not be inferred
  from final success.
- Keep the score advisory. Do not replace eval predicates, critic verdicts,
  repair-loop checks, rollout decisions, or `autonomy-change-decision`
  artifacts with this score.
- Keep records bounded and sanitized: no raw prompts, raw tool outputs,
  secrets, full diffs, cost fields, or hidden reasoning in the score artifact.
- Avoid overclaiming. The report may describe score movement, sample sizes, and
  slice differences, but it must not claim causal model quality without the
  existing eval or rollout evidence.

## Done When

- A typed process-discipline record exists with a stable schema, rubric
  version, per-dimension evidence, unsupported/missing-evidence reasons,
  aggregate score or grade, and source artifact references.
- Workflow agent-step trajectory diagnostics and harness-parity trajectory
  diagnostics can be projected into that record through a shared helper or
  intentionally thin adapters.
- `pnpm kota report` and JSON-mode output include a concise process-discipline
  section for recent runs, grouped by available workflow, harness, task class,
  and area dimensions without duplicating the existing quality stratification
  model.
- Focused tests cover clean disciplined runs, missing final verification,
  repeated identical failing commands, edit-after-pass, unsupported native
  stream evidence, no-op or blocked abstention evidence, and small-sample
  report rendering.
- Existing trajectory-diagnostics, autonomy-report, harness-parity, and task
  validation tests remain green.

## Source / Intent

Explorer run `2026-07-07T12-43-13-576Z-explorer-y7vjze` reviewed a thin queue
with `ready=1`, `doing=0`, `backlog=4`, `pullableCount=3`,
`actionableCount=1`, and `promotableBacklogCount=1`. There was no strategic
ready coverage gap, but the only ready item was a Meta shadow-review task with
active recovery context, so one additional p2 governance task is useful as
near-term strategic work.

Strategic blocked alternatives surfaced by `inspect-queue` were considered but
not chosen because all require operator-captured evidence and were marked
`movable: false`:

- `task-extend-harness-parity-and-eval-harness-with-model-`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-algorithmic-resource-budget-canaries-to-the-ev`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External source checked:

- `https://arxiv.org/abs/2606.22678` ("RigorBench: Benchmarking Engineering
  Process Discipline in Autonomous AI Coding Agents") was submitted on
  2026-06-21 and revised on 2026-06-29. Its useful local signal is not the
  benchmark suite or its weights; it is the claim that process discipline
  should be reported alongside outcome correctness across planning,
  verification, recovery, abstention, and atomicity dimensions.

Local overlap check:

- `task-add-trajectory-quality-diagnostics-for-lucky-pass-` added advisory
  process warnings to harness-parity artifacts.
- `task-write-trajectory-quality-diagnostics-for-workflow-` extended those
  diagnostics to normal workflow agent-step artifacts.
- `task-stratify-autonomy-quality-metrics-before-comparing` grouped existing
  quality signals before comparing pooled trends.
- `task-report-per-component-eval-attribution-for-score-mo` explains which
  agent-system components changed when eval scores move.

The nonduplicative gap is a compact discipline projection from existing local
diagnostics so operators can compare process quality without importing a new
benchmark or treating final pass/fail as sufficient governance evidence.

## Initiative

Outcome-aware autonomy governance.

## Product / Safety Link

Safety: helps prevent KOTA from promoting a model, harness, or workflow change
that passes final checks while becoming less planned, less verified, less
recoverable, or less honest about abstention. The owner-visible outcome is a
report that distinguishes clean autonomous success from process-fragile
success before rollout or queue-shaping decisions rely on it.

## Acceptance Evidence

- Focused test transcript for the process-discipline projection and report
  rendering, including unsupported and missing-evidence cases.
- Sample `.kota/runs/<run-id>/process-discipline-report.json` or equivalent
  `pnpm kota report --json` artifact showing dimension scores, evidence refs,
  and grouped operator summary.
- Diff review showing the projection reads existing trajectory diagnostics and
  does not persist prompts, raw tool outputs, secrets, full diffs, costs, or
  hidden reasoning.
- `pnpm run validate-tasks` passes.

## Completion Notes

- Added `process-discipline-v1` projection records over existing trajectory
  diagnostics with per-dimension evidence, missing/unsupported states, aggregate
  grades, and bounded source artifact refs.
- `kota report` JSON now includes `processDiscipline`; rendered output includes
  a compact Process discipline section grouped by workflow, harness, task class,
  and task area.
- Acceptance artifact:
  `.kota/runs/2026-07-07T13-11-58-632Z-builder-k0smbw/process-discipline-report.json`.
- Validation: targeted process-discipline/autonomy-report tests, existing
  trajectory/harness-parity tests, `pnpm run typecheck`, and `pnpm run lint`
  passed. `pnpm run validate-tasks` passed after final staging. Canonical task
  move was attempted but could not create the external worktree Git
  `index.lock`, so the equivalent state move was applied in the working tree
  and the failure is recorded in the run artifacts.
