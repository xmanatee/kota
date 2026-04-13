---
id: task-prevent-agent-scratch-artifact-commits
title: Prevent agent scratch artifacts from being committed
status: ready
priority: p2
area: autonomy
summary: Make local agent scratch directories impossible or visibly invalid to commit, including the .claude/worktrees artifact that recently landed.
created_at: 2026-04-13T21:39:00.000Z
updated_at: 2026-04-13T21:39:00.000Z
---

## Problem

A recent improver run committed `.claude/worktrees/repair-loop-abort-check`.
That file was local agent scratch state, not project source or durable KOTA
data. It should never have entered git history.

The current repo ignores `.claude/settings.local.json` through a global git
ignore, but the repo-local ignore and commit validation do not clearly cover
agent scratch paths such as `.claude/worktrees/`.

## Desired Outcome

Agent-local scratch artifacts are kept out of commits by repo structure and by
autonomous commit checks. If a future run creates local scratch state, it stays
untracked or fails validation before commit with a clear message.

## Constraints

- Do not ignore real project data such as `data/`, source files, docs, or task
  files.
- Do not hide meaningful generated artifacts that are intentionally committed.
- Keep the ignored/blocked path list small and justified by actual local agent
  scratch behavior.
- Coordinate with improver semantic review so artifact-only commits fail even
  if a new scratch path appears.

## Done When

- `.claude/worktrees/` and any equivalent local scratch path identified during
  investigation cannot be committed accidentally.
- Autonomous commit or repair checks report a clear error if a prohibited
  scratch artifact is staged.
- Existing legitimate `.claude/settings.local.json` behavior remains local.
- Tests or simple validation cover the prohibited artifact path.
