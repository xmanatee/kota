---
id: task-github-pr-review-workflow
title: Add GitHub PR automated review autonomy workflow
status: ready
priority: p2
area: autonomy
summary: The builder opens GitHub PRs via branch-per-task mode, but nothing reviews them. A webhook-triggered autonomy workflow that fetches the PR diff, reviews it with an agent, and posts structured comments closes the builder → PR → review cycle.
created_at: 2026-04-10T09:20:00Z
updated_at: 2026-04-10T09:20:00Z
---

## Problem

When `branchPerTask` is enabled, the builder creates a `kota/task/<task-id>` branch and opens a PR. The PR then sits waiting for a human reviewer. For an autonomous development loop this is a gap: the system that created the change has no mechanism to review it before merge. Operator review time is the bottleneck, and small obvious issues could be caught automatically.

## Desired Outcome

A new autonomy workflow (`pr-reviewer`) that:
1. Triggers on a GitHub webhook event (`pull_request.opened` and `pull_request.synchronize`) for PRs whose head branch matches `kota/task/*`.
2. Fetches the PR diff and linked task file (via `KOTA_TASK_ID` from the PR body or branch name) using the existing GitHub module tools.
3. Runs an agent that reviews the diff for: correctness relative to the task's Done When criteria, obvious bugs or anti-patterns, missing tests, and architectural boundary violations.
4. Posts a structured review comment on the PR via the GitHub API: a summary section, an issues list (blocking / advisory), and a recommendation (approve / request-changes).
5. Emits `workflow.pr.review.posted` on the bus so other workflows can react.

## Constraints

- Trigger only for `kota/task/*` branches; ignore other PRs.
- The review is advisory input to the human reviewer, not an automatic merge gate.
- Requires the GitHub module to be configured with a token that has PR comment permissions.
- Agent prompt for the review step lives in the workflow directory as a markdown asset.
- Must guard against webhook delivery of non-KOTA PRs and against PRs from forks (skip if fork).
- No daemon changes; webhook delivery goes through the existing webhook trigger infrastructure.

## Done When

- `src/modules/autonomy/workflows/pr-reviewer/workflow.ts` and `prompt.md` exist.
- The workflow triggers on `pull_request.opened` and `pull_request.synchronize` webhook events.
- The agent posts a review comment following the structured format.
- `workflow.pr.review.posted` is emitted with `{prNumber, repo, recommendation}` payload.
- A `workflow.test.ts` unit test covers the trigger predicate (only kota branches, not forks).
- The workflow directory has an `AGENTS.md` explaining its role and scope.
