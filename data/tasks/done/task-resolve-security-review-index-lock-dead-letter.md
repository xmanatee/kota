---
id: task-resolve-security-review-index-lock-dead-letter
title: Resolve security-review index-lock dead letter
status: done
priority: p3
area: autonomy
summary: Clear open DLQ dlq-06ffee5b-137d-4a55-bd05-c1e2bb30389f after the security-review task was committed and workflow commits now retry transient index locks. Redrive only if it will not duplicate task-security-review-http-mcp-transport-and-its-oauthpr; otherwise dismiss with durable rationale.
created_at: 2026-06-19T14:11:31.827Z
updated_at: 2026-06-20T00:45:59.736Z
---

## Problem

Clear open DLQ dlq-06ffee5b-137d-4a55-bd05-c1e2bb30389f after the security-review task was committed and workflow commits now retry transient index locks. Redrive only if it will not duplicate task-security-review-http-mcp-transport-and-its-oauthpr; otherwise dismiss with durable rationale.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-19T13-53-34-771Z-progress-reviewer-aspp68.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-19T13-53-34-771Z-progress-reviewer-aspp68.

review verdict: needs-steering
review summary: The 24h kota packet shows Product 3, Safety 0, Platform 0, Meta 1, and Unclassified 16. Recent monitored workflows are progressing, but one security-review DLQ remains open and one Product evidence gap is still unresolved through an existing ready task.

Evidence ids:

- dead-letter:dlq-06ffee5b-137d-4a55-bd05-c1e2bb30389f
- run:2026-06-19T13-42-02-751Z-security-review-hi72jg
- task:task-security-review-http-mcp-transport-and-its-oauthpr
- git:commit:0e4b5944cbe4

## Initiative

Outcome-aware autonomy progress review.

## Resolution

Dead-letter item `dlq-06ffee5b-137d-4a55-bd05-c1e2bb30389f` was dismissed
through the workflow-ops DLQ command after exporting diagnostics to this
builder run directory. Redrive was not used because the failed
`security-review` run was trying to commit
`task-security-review-http-mcp-transport-and-its-oauthpr`, and that task is
already complete in `data/tasks/done/` from commit `ee324625`. The transient
Git index-lock failure class cited by this cleanup task was separately covered
by commit `0e4b5944`, so replaying the stale run would duplicate completed
work instead of resolving a live implementation gap.

## Acceptance Evidence

- `.kota/runs/2026-06-20T00-43-06-892Z-builder-zgkac8/dead-letter-before-dismissal.json` records `status: "open"` for `dlq-06ffee5b-137d-4a55-bd05-c1e2bb30389f` before resolution.
- `.kota/runs/2026-06-20T00-43-06-892Z-builder-zgkac8/dead-letter-after-dismissal.json` records `status: "dismissed"`, `dismissedAt: "2026-06-20T00:45:08.757Z"`, and the superseded-by-completed-security-fix rationale.
- `pnpm dev workflow dlq list --status open --workflow security-review --json` returned `items: []` and `counts.open: 0` after dismissal.
- `find data/tasks -name 'task-security-review-http-mcp-transport-and-its-oauthpr.md' -print` returns only `data/tasks/done/task-security-review-http-mcp-transport-and-its-oauthpr.md`.
- `pnpm validate-tasks` passed after moving this task to `done/`.
