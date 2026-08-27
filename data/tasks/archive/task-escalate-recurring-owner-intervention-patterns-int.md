---
status: done
---

# Escalate recurring owner-intervention patterns into repair tasks

## Problem

KOTA now reports owner-intervention pressure: pending, expired, answered,
dismissed, proposed-answer, and free-form correction outcomes can be
summarized for the operator. That makes individual owner-intervention pressure
visible, but it still leaves the next governance gap: repeated correction
patterns can remain report-only instead of becoming repair work.

If the same workflow, task family, or source surface keeps asking the owner for
the same kind of correction across adjacent runs, that is stronger evidence
than one intervention. It can indicate a prompt contract, task-shaping rule,
tool boundary, or workflow precondition that the autonomous loop should repair
directly. Today the operator can see the pressure, but KOTA has no stable,
idempotent path that converts a recurring owner-intervention pattern into one
bounded ready task with evidence.

## Desired Outcome

Add a deterministic escalation path for recurring owner-intervention patterns.
The implementation should read existing owner-question records and the
owner-intervention aggregation path, group repeated intervention outcomes over
a recent window, and create or refresh exactly one normalized repair task when
a pattern crosses a conservative threshold.

The first slice should cover code-actionable patterns such as:

- repeated free-form corrections for the same workflow, source, task id, or
  task family;
- repeated expired or stale-pending questions from the same workflow/source
  when the local workflow could reduce unnecessary asking or improve fallback
  behavior;
- adjacent-run owner redirects that reject the same proposed option or setup
  assumption; and
- recurring legacy/unknown records only as reportable evidence, not as
  auto-escalated repair work until the missing metadata is fixed.

Each generated or refreshed repair task should include the stable pattern
fingerprint, bounded counts, owner-question ids, workflow/run/task refs when
available, the outcome buckets that crossed the threshold, and a short reason
the pattern is code-actionable.

## Constraints

- Reuse existing owner-question records, run refs, and autonomy report
  aggregation helpers. Do not add a second owner-intervention ledger, metrics
  database, hidden reasoning reader, external dataset import, or issue tracker.
- Keep detection deterministic and conservative. Do not use an LLM judge over
  owner answers or infer private owner intent from long free-form text.
- Treat owner answers as sensitive. Generated tasks may include ids, statuses,
  outcome buckets, timestamps, workflow/source refs, and short redacted
  snippets only when tests prove prompts, answer bodies, secrets, and long text
  are not leaked.
- Escalate only local, code-actionable patterns. Provider outages,
  missing credentials, rate limits, or genuinely unresolved owner decisions
  should remain report or blocked-promoter signals unless KOTA's local handling
  is the defect.
- Suppress duplicates by a stable fingerprint and refresh the existing open
  repair task when evidence changes materially.
- Keep the signal operator-facing. Do not feed intervention-pressure ranking,
  owner answer bodies, or cost fields back into later autonomy-agent prompts.

## Done When

- A typed analyzer emits recurring owner-intervention patterns with stable
  fingerprints, counts, outcome buckets, workflow/source/task dimensions,
  evidence refs, and an explicit code-actionable or ignored reason.
- A workflow or autonomy maintenance step creates or refreshes one valid ready
  task per active owned pattern and no-ops when the same evidence has already
  been captured.
- The attention digest, `kota report`, or equivalent operator surface names
  active recurring owner-intervention patterns and links any generated task ids
  without exposing raw owner answer bodies.
- Focused tests cover repeated free-form corrections, repeated stale/expired
  questions, duplicate suppression, resolved-pattern recovery, ignored
  provider/setup-only patterns, legacy/unknown records that do not auto-
  escalate, and sanitized generated task bodies.
- `pnpm run validate-tasks` passes after synthetic generated repair tasks are
  present in a fixture or temporary project.

## Source / Intent

Explorer run `2026-06-24T09-06-12-007Z-explorer-ad89hv` saw
`strategicReadyCoverageGap=true`: the ready queue contained only a p3 Meta
cleanup task, the backlog was empty, and all surfaced strategic blocked
alternatives still required operator-captured evidence. Those blocked tasks
could not honestly be promoted.

Blocked strategic alternatives considered but not chosen:

- `task-add-a-scientific-claim-reproduction-fixture-to-the` still requires the
  `.kota/runs/scientific-claim-reproduction-live-pass/` operator-captured live
  eval artifact.
- `task-add-algorithmic-resource-budget-canaries-to-the-ev` still requires the
  `.kota/runs/algorithmic-resource-budget-canary-live-pass/` operator-captured
  live eval artifact.
- `task-add-an-unfamiliar-language-strategy-construction-f` still requires the
  `.kota/runs/unfamiliar-language-strategy-construction-live-pass/` operator-
  captured live eval artifact.
- `task-add-cross-preset-runtime-parity-gate` still requires the
  `.kota/runs/preset-parity-all-keys-set/` operator transcript pair with real
  provider auth.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` still requires the
  all-registered-harness `.kota/runs/harness-parity-*` capture.

External source checked:

- `https://arxiv.org/abs/2605.29442` ("How Coding Agents Fail Their Users: A
  Large-Scale Analysis of Developer-Agent Misalignment in 20,574 Real-World
  Sessions", submitted May 28, 2026) studies real IDE and CLI coding-agent
  sessions where misalignment is visible through developer pushback. The
  abstract reports recurring failure forms across project reading, intent
  interpretation, rule following, action bounds, implementation/execution, and
  progress reporting; it also notes that misalignment can persist across
  adjacent sessions and that visible resolutions usually require explicit user
  correction.

KOTA should not import the paper's session dataset or create a new
misalignment taxonomy. The local nonduplicative signal is narrower: once KOTA
can report owner-intervention pressure, repeated owner corrections across
nearby runs should become repairable work instead of a passive report trend.

Local overlap check:

- `task-report-owner-intervention-pressure-in-autonomy-sum` reports
  owner-question pressure and free-form correction outcomes, but it does not
  create or refresh repair tasks when the same intervention pattern recurs.
- `task-escalate-persistent-workflow-failure-patterns-into` handles repeated
  terminal workflow failures, not successful or blocked runs that repeatedly
  need owner correction.
- `task-escalate-recurring-trajectory-diagnostic-patterns-` handles repeated
  trajectory warning codes, not owner-question outcomes.
- `task-record-autonomy-review-scrutiny-metrics` reports reviewer scrutiny and
  thin acceptances, not owner intervention patterns.
- `task-stratify-autonomy-quality-metrics-before-comparing` protects trend
  comparisons from pooled-metric confounding, but it does not convert recurring
  intervention patterns into one actionable repair task.

## Initiative

Outcome-aware autonomy governance.

## Product / Safety Link

This Safety task supports the Product claim that KOTA's autonomous development
loop can be trusted from durable operator-facing evidence, and the Safety
concern that repeated owner corrections or unanswered owner prompts should not
stay hidden behind successful workflow completion or report-only trends.

## Acceptance Evidence

- Completed in run `2026-06-24T09-46-40-701Z-builder-qulwsm`.
- `pnpm exec vitest run src/modules/autonomy/owner-intervention-escalation.test.ts src/modules/autonomy/report/owner-interventions.test.ts src/modules/autonomy/report/render-owner-interventions.test.ts src/modules/autonomy/report/report-cli.test.ts` passed with 17 tests.
- `pnpm exec vitest run src/workflow-validation.integration.test.ts src/modules/autonomy/workflows/prompt-hygiene.test.ts` passed with 85 tests.
- `pnpm run typecheck` passed.
- `pnpm run validate-tasks` passed after staging the task state transition.
- Diff showing the typed recurring-intervention analyzer, fingerprinting,
  task creation/refresh path, operator-surface summary, and sanitized generated
  task body.
- Focused test transcript covering repeated free-form corrections, repeated
  stale/expired questions, duplicate suppression, resolved-pattern recovery,
  ignored infrastructure/setup-only patterns, legacy/unknown records, and
  output redaction.
- Fixture or temporary-project transcript showing synthetic owner-question
  records produce exactly one valid ready repair task with evidence refs and a
  stable pattern marker.
- `pnpm kota report` or JSON-mode fixture output showing recurring owner-
  intervention patterns and generated task ids without raw owner answer bodies,
  prompts, secrets, diffs, or cost fields.
- `pnpm run validate-tasks` output showing the task queue remains valid.
