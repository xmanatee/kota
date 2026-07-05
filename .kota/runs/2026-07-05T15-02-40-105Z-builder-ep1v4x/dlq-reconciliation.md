# Progress-Reviewer Timeout DLQ Reconciliation

Checked at: 2026-07-05T15:14:40.871Z

## Cited Items

Read-only source:
`/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json`

| id | status | trigger | failed run | failure | redrive attempts |
| --- | --- | --- | --- | --- | --- |
| `dlq-8582e38e-3782-44d7-a1d7-db376727edfc` | open | `workflow.batch.flushed` | `2026-07-03T17-14-33-757Z-progress-reviewer-13d1zy` | `review-evidence` timed out after 1800000ms | 0 |
| `dlq-15e44129-2278-490f-a3c4-dcf6a08c6d43` | open | `autonomy.progress-review.scheduled` | `2026-07-03T17-32-22-251Z-progress-reviewer-gn8tqh` | `review-evidence` timed out after 1800000ms | 0 |
| `dlq-112bbfd9-632e-460a-9a0b-4a126f4603f8` | open | `autonomy.progress-review.scheduled` | `2026-07-03T23-08-07-836Z-progress-reviewer-0s9rje` | `review-evidence` timed out after 1800000ms | 0 |

## Same-Shape Success

Progress-reviewer run `2026-07-05T15-00-00-010Z-progress-reviewer-130fdl`
was triggered by `autonomy.progress-review.scheduled`, completed with
`status: success`, and its `review-evidence` step completed with
`status: success` in 155153ms. The reviewer cited these same three open DLQ
ids and the health-reviewer skip, which means the current gap was health
review routing/dedupe, not a still-reproducible inability for
`progress-reviewer` to complete `review-evidence`.

## Source Fix

This builder run changes the health-reviewer action path so a closed
same-dedupe task only suppresses the same evidence fingerprint. A completed
older repair for fingerprint `bf712eea3fd1821c` no longer masks current
fingerprint `efbb647e9b838769`. New evidence after a terminal same-dedupe task
is routed to a fingerprint-scoped ready task id while preserving the original
`autonomy-health-dedupe-key` marker in the task body.

Regression evidence:

- `pnpm test src/modules/autonomy/workflows/autonomy-health-reviewer/health-review-terminal-task.test.ts`
  passed with 1 test covering the done-same-dedupe/different-fingerprint case.
- `pnpm test src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/health-review-terminal-task.test.ts`
  passed with 17 tests.

## Dismissal Rationale

Redriving the three July 3 items would replay stale progress-review windows
that have already been superseded by the successful July 5 scheduled
progress-review. The appropriate runtime reconciliation is dismissal with this
reason:

> Superseded by progress-reviewer run
> `2026-07-05T15-00-00-010Z-progress-reviewer-130fdl` reaching
> `review-evidence` successfully and by builder run
> `2026-07-05T15-02-40-105Z-builder-ep1v4x` fixing health-reviewer
> same-dedupe/different-fingerprint masking; redrive of the stale July 3
> review would duplicate superseded review context.

I attempted the canonical dismissal command for
`dlq-112bbfd9-632e-460a-9a0b-4a126f4603f8`, but this sandbox cannot write the
canonical runtime store:

```text
Fatal: /Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json: failed to write JSON file atomically: EPERM: operation not permitted, open '/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json.tmp'
```

Because the write boundary is outside this task worktree, the live canonical
rows remain open after this builder step. The source fix and durable dismissal
rationale above are the reviewable reconciliation record for this run.
