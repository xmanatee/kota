---
id: task-resolve-stale-builder-dead-letter-item
title: Resolve stale builder dead-letter item
status: blocked
priority: p2
area: workflow-runtime
task_class: Meta
summary: Review open dead-letter dlq-9362cac4-7574-4718-bbf4-31ff4d2f65ef from builder workflow-dispatch failure, decide whether the failed run was superseded by later successful builder work or still needs redrive, then redrive or dismiss it with recorded rationale.
created_at: 2026-07-07T02:48:09.179Z
updated_at: 2026-07-07T02:55:07.608Z
---

## Problem

    Review open dead-letter dlq-9362cac4-7574-4718-bbf4-31ff4d2f65ef from builder workflow-dispatch failure, decide whether the failed run was superseded by later successful builder work or still needs redrive, then redrive or dismiss it with recorded rationale.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-07T02-12-01-050Z-progress-reviewer-fkt7by.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-07T02-12-01-050Z-progress-reviewer-fkt7by.

review verdict: needs-steering
review summary:

    Window balance: Safety 5, Product 3, Platform 1, Meta 9. Recent work is mostly moving: the builder closed the loop-quality audit task and security review created a ready Safety task for a confirmed low-severity route issue, but one open builder dead-letter remains from a repair-agent websocket timeout.

Evidence ids:

- dead-letter:dlq-9362cac4-7574-4718-bbf4-31ff4d2f65ef
- run:2026-07-07T00-47-50-272Z-builder-rwmd89

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    Dead-letter queue item is dismissed or redriven with a run artifact or transcript recording the rationale, and a follow-up progress-review evidence packet reports zero open dead letters or cites the redrive outcome.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-07-07T02-12-16-204Z-builder-xh6p1j/operator-dead-letter-after-dismissal.json
description: canonical DLQ dismissal evidence — operator runs the recorded dismissal for dlq-9362cac4-7574-4718-bbf4-31ff4d2f65ef from an environment that can write /Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json, then captures the after-state JSON showing status dismissed and the stale/superseded rationale under this path
```

## Status (2026-07-07 builder)

The DLQ is stale but not writable from this builder sandbox.
`.kota/runs/2026-07-07T02-12-16-204Z-builder-xh6p1j/dead-letter-resolution.md`
records the canonical open item, failed run, superseding successful run, exact
dismissal rationale, and two blocked mutation attempts.

Evidence summary:

- `canonical-dead-letter-open-item.json` preserves the canonical item with `status: "open"`.
- `failed-run-summary.json` shows failed run `2026-07-06T20-49-21-197Z-builder-tvwxsg` claimed `task-add-loop-quality-audits-for-autonomous-workflows` and failed at `build`.
- `superseding-run-summary.json` shows `2026-07-07T00-47-50-272Z-builder-rwmd89` claimed the same task and completed successfully.
- The done task record for `task-add-loop-quality-audits-for-autonomous-workflows` and progress-review evidence cite commit `545ecf84ab5c`.
- Daemon HTTP dismissal was blocked by `connect EPERM 127.0.0.1:49731`.
- Direct canonical CLI dismissal reached KOTA code but failed to write `items.json.tmp` with `EPERM`.

This task is blocked on operator-captured canonical dismissal evidence rather
than marked done from a worktree-local rationale alone.
