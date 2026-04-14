---
id: task-verify-research-and-autonomy-quality-front
title: Verify research and autonomy quality fixes
status: done
priority: p1
area: autonomy
summary: After the focused fixes land, verify that resource research and improver commits are honest, useful, and protected against the recent failure modes.
created_at: 2026-04-13T21:39:00.000Z
updated_at: 2026-04-14T02:51:51.842Z
---

## Problem

Several recent problems share one root cause: the autonomous loop can make a
plausible-looking terminal move without enough semantic truth. Examples include
auth-walled resources being recorded as dismissed research and an improver run
committing only local scratch state before the next run corrected it.

Focused tasks should fix these separately, then the result needs one coherent
review so the system does not keep local patches that leave the overall quality
front weak.

## Desired Outcome

The research and autonomy quality front is verified end-to-end. Resource tasks
stay honest when source access fails, improver commits are semantically useful,
and scratch artifacts cannot land as project changes.

## Constraints

- Depends on:
  - `task-reprocess-inaccessible-research-resources-honestly`
  - `task-make-source-access-failures-first-class`
  - `task-add-improver-semantic-quality-gate`
  - `task-prevent-agent-scratch-artifact-commits`
- Keep this as a verification task. Do not redo broad implementation unless a
  remaining issue is small and directly part of verification.
- If a dependency is still open, leave this task in backlog.
- Do not create a new documentation surface; update the closest existing
  standards, task, or workflow instruction only if needed.

## Done When

- Historical inaccessible resources have honest non-pretend dispositions.
- A new URL-dependent research task cannot be completed as done when required
  sources were never read and no blocker/follow-up exists.
- Improver cannot commit artifact-only or no-op changes as a successful
  autonomy improvement.
- Local scratch artifacts such as `.claude/worktrees/` are ignored or rejected
  before commit.
- Current queue validation and local instructions remain concise and aligned
  with the module-first, quality-first standards.
