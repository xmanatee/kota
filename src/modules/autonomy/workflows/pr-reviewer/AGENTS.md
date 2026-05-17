# PR Reviewer Workflow

This directory owns automated review for KOTA-created task PRs.

## Scope

- Review only PRs whose head branch matches `kota/task/*`.
- Skip forks, non-KOTA branches, irrelevant webhook actions, and PR events
  whose normalized actor integrity is missing, blocked, or below the workflow's
  trust threshold.
- The review is advisory — it does not gate or auto-merge the PR.
- Requires the GitHub module to be configured with a token that has PR comment permissions.
