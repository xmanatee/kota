---
status: done
---

# Repair recurring owner intervention for autonomy-health-reviewer

## Problem

Recent owner-question records show the same owner-intervention pattern
crossing the escalation threshold. One correction or unanswered prompt can
be normal; this task exists because the repeated pattern points to a local
workflow, task-shaping, prompt, or fallback behavior that should improve.

Pattern fingerprint: `owner-intervention:repeated-stale-or-expired:code-actionable:workflow:78900ea2ae6c`
Evidence fingerprint: `3f3363578a81904c400110a8d8cc248c978a85a99cc82d26771e687fdf13c4e6`

## Owner-Intervention Evidence

- Pattern kind: repeated-stale-or-expired
- Grouping dimension: workflow autonomy-health-reviewer
- Questions: 3
- Distinct runs: 2
- Outcome buckets: not-answered
- Statuses: pending
- Workflow names: autonomy-health-reviewer
- Sources: autonomy-health-reviewer
- Task ids: (none)
- Run ids: 2026-06-22T03-23-12-088Z-autonomy-health-reviewer-y4z2k6, 2026-06-27T08-35-34-405Z-autonomy-health-reviewer-d4oc61
- Owner-question ids: 0188475d, 9a17b6f8, fc2c0444
- Window: 2026-06-22T04:48:56.734Z to 2026-06-27T10:22:06.915Z
- Active reason: repeated stale or expired owner questions for workflow autonomy-health-reviewer

- 0188475d pending not-answered; refs: owner-question:0188475d run:2026-06-22T03-23-12-088Z-autonomy-health-reviewer-y4z2k6; source: autonomy-health-reviewer; markers: stale-pending
- fc2c0444 pending not-answered; refs: owner-question:fc2c0444 run:2026-06-22T03-23-12-088Z-autonomy-health-reviewer-y4z2k6; source: autonomy-health-reviewer; markers: stale-pending
- 9a17b6f8 pending not-answered; refs: owner-question:9a17b6f8 run:2026-06-27T08-35-34-405Z-autonomy-health-reviewer-d4oc61; source: autonomy-health-reviewer; markers: stale-pending

## Desired Outcome

Repair the local workflow, prompt contract, task-shaping rule, or fallback
path so comparable work no longer needs repeated owner corrections or
stale/expired owner prompts for the same grouped source.

## Constraints

- Build on existing owner-question records and owner-intervention report
  aggregation; do not add another intervention ledger or metrics store.
- Keep owner answers sensitive: use ids, statuses, outcome buckets,
  timestamps, workflow/source/task refs, and short sanitized summaries only.
- Do not infer private owner intent from long free-form answers.
- Treat provider outages, missing credentials, and setup-only answers as
  report or blocked-promoter signals unless local handling is the defect.
- Keep spend metrics and owner answer bodies out of autonomy-agent prompts.

## Product / Safety Link

This Safety repair supports the Product claim that KOTA's autonomous loop
can be trusted from operator-visible evidence, and the Safety concern that
repeated owner corrections should not stay hidden behind successful runs.

## Done When

- Fresh owner-intervention windows no longer trigger this pattern
  fingerprint, or the detector threshold/fingerprint is deliberately
  adjusted with focused tests and evidence.
- Comparable owner-question paths record enough workflow/source/task
  metadata for later review without exposing raw owner answer bodies.
- Operator-facing report or attention output still names future recurring
  owner-intervention patterns and repair task ids without answer bodies,
  prompts, secrets, diffs, spend metrics, or hidden reasoning.

## Source / Intent

Auto-created by `owner-intervention-escalator` from sanitized
owner-question records. Repeated owner corrections and stale prompts should
become one bounded repair task instead of remaining only in a report trend.

## Initiative

Outcome-aware autonomy governance.

## Acceptance Evidence

- Focused test output for the repaired owner-question or workflow path.
- Detector or report fixture showing this pattern no longer crosses the
  escalation gate on fresh evidence.
- Operator-facing report or attention fixture showing future escalations
  include the repair task id without owner answer bodies or spend metrics.
- Run artifact: `.kota/runs/2026-06-28T15-01-53-860Z-builder-v8pjn8/acceptance-evidence.md`

<!-- owner-intervention-pattern-fingerprint: owner-intervention:repeated-stale-or-expired:code-actionable:workflow:78900ea2ae6c -->
<!-- owner-intervention-evidence-fingerprint: 3f3363578a81904c400110a8d8cc248c978a85a99cc82d26771e687fdf13c4e6 -->
