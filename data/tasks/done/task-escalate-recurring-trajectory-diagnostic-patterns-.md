---
id: task-escalate-recurring-trajectory-diagnostic-patterns-
title: Escalate recurring trajectory-diagnostic patterns into repair tasks
status: done
priority: p2
area: autonomy
summary: Aggregate repeated workflow agent-step trajectory diagnostic warnings from run artifacts and open stable, idempotent repair tasks when the same process-quality pattern keeps recurring.
created_at: 2026-05-29T05:22:54.401Z
updated_at: 2026-05-29T05:39:11.419Z
---

## Problem

KOTA now writes deterministic trajectory diagnostics for workflow agent steps,
including warning codes such as missing final verification, repeated failing
commands, edit-after-pass, and unsupported native message streams. Those
artifacts are useful when an operator opens a single run, but recurring
process-quality failures still remain manual to spot.

The autonomy loop can finish many successful runs while repeatedly producing
the same warning class in the same workflow or step. Today that pattern does
not automatically become a normalized repair task. The existing workflow
failure escalator catches repeated terminal failures; it does not cover
"successful but repeatedly weak" trajectory-diagnostic evidence.

## Desired Outcome

Autonomy has a deterministic escalation path for recurring trajectory-
diagnostic patterns. A code-owned scan reads recent workflow run artifacts,
groups repeated warning patterns by stable keys, and creates or refreshes one
repair task per pattern when a threshold is crossed.

Operators should see the pattern, affected workflows/steps, evidence run ids,
and the repair task id through the same queue/report surfaces they already use
for persistent workflow failures. Clean runs and isolated advisory warnings
should remain advisory and should not create noise.

## Constraints

- Reuse KOTA's existing `steps/<step-id>.trajectory-diagnostics.json`
  artifacts. Do not scrape raw `*.events.jsonl` streams unless a test fixture
  deliberately materializes a diagnostic artifact from them.
- Keep the first slice deterministic: group by typed warning code, workflow
  name, step id, and a bounded detail fingerprint. Do not import Agentic CLEAR,
  add a dashboard, or introduce an LLM judge / dynamic taxonomy for this task.
- Do not duplicate `workflow-failure-escalation`. Terminal failures stay owned
  by that mechanism; this task handles repeated successful-run process-quality
  warnings.
- The escalation must be idempotent by a stable pattern fingerprint and must
  update existing open repair tasks instead of creating duplicates.
- Keep raw prompts, tool outputs, secrets, and long event streams out of the
  generated task body. Evidence should be run ids, artifact paths, warning
  codes, and concise bounded details.
- Do not feed operator-only cost or report ranking back into agent prompts.

## Done When

- A typed analyzer reads recent `.kota/runs/` workflow run artifacts and emits
  recurring trajectory-diagnostic patterns with stable fingerprints, counts,
  affected workflows/steps, and evidence artifact paths.
- A workflow or existing autonomy maintenance step creates/updates one
  normalized repair task when a pattern crosses an explicit threshold, with a
  marker that prevents duplicate task creation for the same fingerprint.
- The operator report or attention digest names the top active trajectory-
  diagnostic patterns and links them to any generated repair tasks.
- Synthetic run-artifact tests cover no-warning, isolated-warning,
  repeated-warning, duplicate-task, and stale-pattern recovery cases.
- Existing trajectory diagnostic artifacts, workflow-failure escalation, and
  task validation continue to pass unchanged.

## Source / Intent

Explorer run `2026-05-29T05-20-58-262Z-explorer-km9jh8` saw an empty actionable
queue: `ready=0`, `doing=0`, and two backlog research tasks both dependency-
waiting on `task-enable-autonomous-access-to-auth-walled-sources-so`. The
surfaced strategic blocked alternatives were all `operator-capture` gated and
reported `movable=false`:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://ibm.github.io/CLEAR/` — Agentic CLEAR describes automated
  multi-level trace evaluation that surfaces recurring system/node/trace
  failure patterns instead of leaving developers to manually inspect many
  traces.

Local overlap check:

- `task-add-trajectory-quality-diagnostics-for-lucky-pass-` added deterministic
  trajectory diagnostics for harness-parity runs.
- `task-write-trajectory-quality-diagnostics-for-workflow-` extended those
  diagnostics to normal workflow agent steps.
- `task-escalate-persistent-workflow-failure-patterns-into` escalates repeated
  terminal workflow failures into repair tasks.
- Repository search found no open task that aggregates repeated trajectory
  warning codes from successful workflow runs into stable repair tasks.

The nonduplicative KOTA gap is not importing CLEAR or adding an LLM trace
judge. It is making KOTA's existing typed trajectory warnings actionable when
the same process-quality issue keeps recurring.

## Initiative

Outcome-grade autonomy evaluation: successful workflow runs should remain
inspectable and repairable when process-quality evidence shows repeated weak
success patterns.

## Acceptance Evidence

- Focused tests pass for the pattern analyzer and escalation task creation,
  for example
  `pnpm test src/modules/autonomy/trajectory-diagnostic-escalation.test.ts src/modules/autonomy/workflows/trajectory-diagnostic-escalator/workflow.test.ts`.
- A captured transcript under `.kota/runs/<run-id>/` shows the analyzer
  creating or updating one repair task from synthetic repeated trajectory
  diagnostic artifacts.
- The generated repair task body includes the pattern fingerprint, warning
  codes, evidence run ids, and artifact paths while omitting raw prompts and
  full tool outputs.
- `pnpm run validate-tasks` passes after the generated repair task is present.
