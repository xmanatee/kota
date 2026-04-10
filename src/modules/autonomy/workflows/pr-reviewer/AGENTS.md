# PR Reviewer Workflow

This directory contains the `pr-reviewer` autonomy workflow.

## Purpose

Reviews pull requests opened by the KOTA builder on `kota/task/*` branches. When the GitHub
webhook delivers a `pull_request.opened` or `pull_request.synchronize` event for a KOTA task
branch, this workflow:

1. Validates the event (correct action, KOTA branch, not a fork).
2. Runs an agent that fetches the PR diff, reads the linked task's Done When criteria, and
   reviews for correctness, bugs, missing tests, and architectural violations.
3. Posts a structured review comment on the PR.
4. Emits `workflow.pr.review.posted` on the bus.

## Scope

- Reviews only PRs whose head branch matches `kota/task/*`.
- Skips PRs from forks, non-KOTA branches, and irrelevant webhook actions.
- The review is advisory — it does not gate or auto-merge the PR.
- Requires the GitHub module to be configured with a token that has PR comment permissions.

