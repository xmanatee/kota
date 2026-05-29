---
id: task-escalate-persistent-workflow-failure-patterns-into
title: Escalate persistent workflow failure patterns into repair tasks
status: done
priority: p2
area: modules
summary: Detect repeated workflow-level failure patterns from run artifacts and open or refresh one evidence-backed repair task instead of leaving the signal only in digests or improver context.
created_at: 2026-05-29T02:45:38.351Z
updated_at: 2026-05-29T03:06:14.000Z
---

## Problem

KOTA already has useful workflow-health surfaces, but persistent workflow
failure patterns do not yet have a deterministic path into the work queue.
`src/modules/autonomy/run-outcome-aggregation.ts` aggregates recent failure
rates and repair-check patterns for improver, and
`src/modules/autonomy/workflows/attention-digest/step.ts` alerts on a few
operator-facing conditions such as builder failure streaks, repeated builder
warnings, blocked tasks, and empty queues. Those signals are visible, but a
non-builder workflow that fails with the same owned cause for several days can
still remain an attention/improver observation instead of becoming one
evidence-backed repair task.

GitHub Agentic Workflows now shows this as a concrete peer-runtime pattern:
its Agent Performance Analyzer scans the whole workflow fleet, detects
multi-day 100% failure patterns, and files an issue with direct evidence
instead of waiting for a person to notice the recurrence.

## Desired Outcome

Add a deterministic autonomy repair-escalation path for persistent workflow
failure patterns. The implementation should read existing run artifacts,
classify repeated workflow-level failures, and create or refresh one normalized
ready task with the evidence when a pattern crosses a threshold.

The first slice should cover patterns KOTA can act on without owner secrets or
external service changes:

- same workflow failing N consecutive completed runs with the same owned
  failure class or repair-check id;
- same workflow at 100% terminal failure rate over a minimum day/run window;
- repeated completed-with-warnings on the same repair-check warning when the
  workflow otherwise looks healthy enough that improver will not necessarily
  fire.

The escalation should be idempotent by a stable pattern fingerprint, include
the run ids and failure evidence in the generated task, and emit or reuse an
operator-visible attention event so the operator sees why the queue changed.

## Constraints

- Reuse existing run metadata, repair-iteration artifacts, and
  `run-outcome-aggregation` helpers where practical. Do not add a second
  persistent stats store, external issue tracker, or parallel workflow-health
  ledger.
- Keep the mechanism deterministic and typed. Agent judgment may later repair
  the issue, but the threshold detection and task creation should not depend
  on an LLM.
- Preserve the existing no-cost-bias rule: cost and throughput report data stay
  operator-facing and must not be injected into autonomy agents.
- Do not escalate classified provider/auth/rate-limit/timeout infrastructure
  failures that code changes cannot fix. Those may remain attention items, but
  should not create repair tasks unless the local runtime handling is the
  owned defect.
- Avoid one task per run. One pattern gets one stable task that is refreshed or
  no-oped until the pattern changes materially.
- Do not broaden explorer into a general failure monitor. This belongs in the
  autonomy runtime/workflow layer, likely near attention-digest,
  evaluator-calibration-monitor, or a focused sibling workflow.

## Done When

- A detector identifies persistent workflow failure patterns from `.kota/runs/`
  using stable thresholds and a pattern fingerprint.
- The detector creates or refreshes exactly one normalized ready task per
  active owned pattern, including run ids, workflow names, failure class or
  repair-check ids, and the reason the pattern is considered code-actionable.
- Existing infrastructure/provider failure exclusions remain honored and are
  covered by tests.
- Repeated invocations with unchanged evidence are idempotent and do not churn
  task files or produce duplicate ready tasks.
- The operator-facing attention surface names newly escalated patterns or the
  generated task id without exposing cost signals to autonomy agents.
- Focused tests cover new-pattern creation, duplicate suppression, resolved
  pattern behavior, and ignored infrastructure failure patterns.

## Source / Intent

Explorer run `2026-05-29T02-42-52-572Z-explorer-ved6b7` found an empty
actionable queue. The strategic blocked alternatives were all real
operator-capture waits and not movable, so opening one autonomy-health slice is
preferable to declaring no-op or opening client fan-out work.

External source checked:

- `https://github.github.com/gh-aw/blog/2026-05-27-agent-of-the-day/` reports
  that GitHub Agentic Workflows' Agent Performance Analyzer scans 236 workflows
  daily, scores quality/effectiveness/ecosystem health, and auto-filed an
  issue after two named workflows failed at a 100% rate for five or more
  consecutive days.
- `https://github.com/github/gh-aw` describes GitHub Agentic Workflows as
  natural-language workflows running in GitHub Actions with guardrails,
  sandboxing, sanitized outputs, network isolation, tool allow-listing, and
  compile-time validation.

Local context checked:

- `src/modules/autonomy/run-outcome-aggregation.ts` already aggregates failure
  rates, repair-check failures, duration outliers, and infrastructure
  exclusions for improver.
- `src/modules/autonomy/workflows/attention-digest/step.ts` already alerts on
  builder failure streaks, repeated builder warnings, blocked work, and empty
  queues.
- `src/modules/autonomy/workflows/evaluator-calibration-monitor/` already
  shows the right shape for one deterministic monitor that opens or recreates a
  specific repair task when repeated evidence crosses a gate.

## Initiative

Autonomy fleet health: repeated workflow failures should graduate from
operator-visible observations into one evidence-backed repair task when the
pattern is local, actionable, and stable.

## Acceptance Evidence

- Focused test transcript for the detector and task-escalation path, including
  duplicate suppression and ignored infrastructure failures.
- Fixture or temporary-project evidence showing a synthetic repeated workflow
  failure pattern creates one valid ready task with run ids and a stable
  fingerprint.
- `pnpm kota task validate` or the repository's queue-validation command
  passes after the generated task is created in the fixture.
- Attention/on-demand output or a captured event fixture shows the escalated
  pattern and generated task id without cost fields.
