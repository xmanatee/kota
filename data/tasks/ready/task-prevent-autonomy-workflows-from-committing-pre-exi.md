---
id: task-prevent-autonomy-workflows-from-committing-pre-exi
title: Prevent autonomy workflows from committing pre-existing dirty worktree changes
status: ready
priority: p1
area: autonomy
summary: Add a workflow commit hygiene guard so non-owning workflows such as security-review cannot sweep unrelated tracked dirt left by a failed builder into their own commit. The guard should detect pre-existing dirty files before action steps, stage only declared/touched paths, and fail or route to recovery when unrelated dirt is present.
created_at: 2026-06-17T09:32:42.160Z
updated_at: 2026-06-17T09:32:42.160Z
---

## Problem

Add a workflow commit hygiene guard so non-owning workflows such as security-review cannot sweep unrelated tracked dirt left by a failed builder into their own commit. The guard should detect pre-existing dirty files before action steps, stage only declared/touched paths, and fail or route to recovery when unrelated dirt is present.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-17T09-20-02-435Z-progress-reviewer-xfwu8w.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-17T09-20-02-435Z-progress-reviewer-xfwu8w.

review verdict: needs-steering
review summary: Recent activity produced useful security-review output and task progress, but the batch shows a serious autonomy commit-boundary problem: a timed-out builder left dirty work, a later builder skipped because the tree was dirty, and security-review committed a large unrelated dirty diff under a task-creation commit.

Evidence ids:

- run:2026-06-17T06-19-56-000Z-builder-3yxnid
- run:2026-06-17T09-20-01-705Z-builder-xtu3o4
- run:2026-06-17T09-20-01-930Z-security-review-csweh4
- git:commit:7305e7f558aa

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Focused workflow/runtime test where a failed builder leaves tracked dirt, security-review creates a task, and the commit step either stages only the security-review task path or refuses to commit with a recovery artifact; regression asserts unrelated dirty paths are not included in the security-review commit.
