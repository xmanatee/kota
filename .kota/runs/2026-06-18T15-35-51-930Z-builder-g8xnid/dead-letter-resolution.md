# Progress Reviewer DLQ Resolution

Resolved DLQ: `dlq-66e3e96d-8c51-440a-8340-5d77c037c888`.

## Before

- Export: `.kota/runs/2026-06-18T15-35-51-930Z-builder-g8xnid/dead-letter-before-dismissal.json`
- Status: `open`
- Failure: `claim-digest-closeout-has-current-evidence` cited hidden artifact ids from `.kota/runs/2026-06-18T14-07-07-823Z-builder-s04an8/`.

## Resolution

Dismissed with:

`env -u NODE_OPTIONS pnpm kota workflow dlq dismiss dlq-66e3e96d-8c51-440a-8340-5d77c037c888 --reason "Superseded by progress-reviewer evidence validation fix 8073cf388d68; same-shape run 2026-06-18T15-25-02-822Z-progress-reviewer-zo0j48 completed apply-actions and write-artifact successfully, so redriving the pre-fix batch would duplicate stale context."`

Redrive was not used because the failed batch predates commit `8073cf388d68`, and a later run with the same run-count progress-reviewer shape completed the affected steps successfully:

- `.kota/runs/2026-06-18T15-25-02-822Z-progress-reviewer-zo0j48/steps/apply-actions.json`: `status: success`
- `.kota/runs/2026-06-18T15-25-02-822Z-progress-reviewer-zo0j48/steps/write-artifact.json`: `status: success`

## After

- Export: `.kota/runs/2026-06-18T15-35-51-930Z-builder-g8xnid/dead-letter-after-dismissal.json`
- Status: `dismissed`
- Dismissed at: `2026-06-18T15:40:13.748Z`

Open progress-reviewer DLQ verification:

`env -u NODE_OPTIONS pnpm kota workflow dlq list --status open --workflow progress-reviewer --json`

Result:

```json
{
  "items": [],
  "counts": {
    "open": 0,
    "dismissed": 23,
    "redriven": 0
  }
}
```

Note: `pnpm kota task move task-clear-progress-reviewer-hidden-evidence-dlq doing` was attempted after rebuilding ignored `dist/`, but this sandbox cannot create `.git/index.lock`, so the task file move was applied manually in the working tree.
