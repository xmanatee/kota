---
id: task-add-general-runtime-issue-recovery-loop
title: Add general runtime issue recovery loop
status: done
priority: p1
area: autonomy
summary: Add a bounded runtime health auditor that consolidates logs, DLQ, interrupted runs, shutdown failures, and operator-visible runtime warnings into one evidenced repair or owner-action path.
created_at: 2026-06-16T00:18:54.552Z
updated_at: 2026-06-19T00:50:29.000Z
task_class: Platform
---

## Problem

KOTA has partial self-recovery, but not a general mechanism that regularly
reads daemon/module logs, dead letters, interrupted runs, stuck shutdowns, and
repeated operator-visible runtime failures, then creates one bounded repair
task or owner ask with evidence.

Current mechanisms cover adjacent slices:

- `runtime.recovered` marks stale active workflow runs interrupted and wakes
  recovery-capable workflows.
- `workflow-failure-escalator` opens repair tasks for repeated
  non-infrastructure workflow failure patterns from `.kota/runs` metadata.
- `trajectory-diagnostic-escalator` opens repair tasks for repeated typed
  trajectory diagnostics.
- `progress-reviewer` can cite runs, dead-letter counts/items, tasks,
  approvals, owner questions, artifacts, and git evidence.
- `attention-digest` surfaces failed/interrupted monitored runs.

The remaining gap is runtime health evidence outside those narrow paths:
module/channel logs are not part of a deterministic recovery loop, repeated
open DLQ patterns and stale DLQ items are not guaranteed to consolidate into
repair work, and interrupted runs or graceful-stop timeouts can surface in
inbox without becoming root-cause repair work.

## Desired Outcome

Add a daemon/runtime health auditor workflow, or extend an existing workflow,
so KOTA can periodically and on `runtime.recovered` inspect:

- `.kota/modules/*/logs.jsonl`
- `.kota/dead-letter-queue/items.json`
- recent failed/interrupted run metadata
- daemon shutdown/stop evidence
- operator inbox runtime warnings

The auditor should classify local-code, external-service/auth,
operator-action, duplicate-consumer, and cost-risk patterns. It should create
at most one ready repair task per stable local-code pattern, one owner
question/setup item per operator-action pattern, and one attention digest entry
per unresolved high-risk pattern.

## Constraints

- Avoid noisy meta churn: consolidate by root cause, cite exact evidence, and
  mark patterns as already covered when an open task or owner action exists.
- Do not create one task per log line, run, dead-letter item, channel module,
  or transient provider failure.
- Do not duplicate `workflow-failure-escalator` or
  `trajectory-diagnostic-escalator`; reuse or coordinate with them where the
  evidence source overlaps.
- Treat external-service/auth and operator-action failures as owner/setup
  paths unless there is clear local-code evidence.
- Redact secrets and sensitive payload details from generated tasks, owner
  asks, digest entries, and fixtures.

## Done When

- A deterministic runtime-health audit path runs on a cadence and on
  `runtime.recovered`.
- The audit reads the relevant module logs, DLQ records, run metadata,
  shutdown/stop evidence, and inbox runtime warnings without relying on
  operator manual review.
- The audit classifies each stable pattern into local-code,
  external-service/auth, operator-action, duplicate-consumer, or cost-risk.
- Stable local-code patterns create one deduped ready repair task with cited
  evidence.
- Operator-action patterns create one owner question/setup item instead of a
  local repair task.
- Unresolved high-risk patterns are surfaced through attention digest evidence.
- Already-covered patterns are recorded as covered instead of creating duplicate
  work.

## Source / Intent

Sorted from `data/inbox/task-add-general-runtime-issue-recovery-loop.md` on
2026-06-16. The capture called out repeated Telegram Bot API `getUpdates`
conflicts and network failures in `.kota/modules/telegram/logs.jsonl` as an
example where module/channel log patterns did not automatically become repair
work.

## Initiative

Runtime health and autonomous recovery.

## Acceptance Evidence

- `pnpm exec vitest run src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/workflow.test.ts` passed: 3 files, 11 tests, including daemon stop-attempt evidence and status-derived operator runtime warnings.
- `pnpm exec vitest run src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/workflow.test.ts src/modules/daemon-ops/operator-inbox.test.ts src/modules/daemon-ops/daemon-ops-daemon-client.test.ts` passed: 5 files, 27 tests.
- `pnpm exec vitest run src/workflow-validation.integration.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/workflow.test.ts` passed: 3 files, 90 tests.
- `pnpm exec vitest run src/core/modules/module-deps.test.ts` passed: 1 file, 2 tests.
- `pnpm exec tsc --noEmit --pretty false` passed.
- `git add -A` and `pnpm run validate-tasks` passed with the real staged task move/source edits.
