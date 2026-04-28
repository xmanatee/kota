---
id: task-resolve-blocked-architecture-front-before-more-fan
title: Resolve blocked architecture front before more fan-out
status: backlog
priority: p1
area: architecture
summary: Create an operator-facing plan to clear or decompose the currently blocked architecture tasks (KotaClient namespace distribution, auth-walled access, rich CLI rendering, multi-project supervision, harness parity, Telegram deploy) instead of accumulating new fan-out work.
created_at: 2026-04-28T22:04:28.711Z
updated_at: 2026-04-28T22:04:28.711Z
---

## Problem

The 2026-04-28 broad daemon review found the remaining important work is
mostly already normalized but blocked: KotaClient namespace distribution,
auth-walled source access, rich CLI rendering, multi-project supervision,
harness parity evidence, and Telegram deploy proof. Autonomy can keep making
progress by seeding small tasks, but the architecture front will not become
"perfect" while these blockers sit. Today the queue grows around them rather
than through them.

## Desired Outcome

An operator-facing plan that makes each blocked architecture task actionable:

- For `owner-decision` blockers, re-ask with concrete recommended answers.
- For `operator-capture` blockers, produce exact commands and artifact paths
  the operator can run to clear the block.
- For `capability-installed` blockers, surface the deterministic probe and the
  next step needed to satisfy it.
- Where a blocked task is too large for one builder run, propose a concrete
  decomposition into a foundation task plus follow-ups.

After the plan lands, each blocked architecture task either has a clear
unblock path the operator can execute, or is decomposed into smaller tasks
that can move under the existing precondition vocabulary.

## Constraints

- Use only the existing `Unblock Precondition` vocabulary
  (`task-done`, `capability-installed`, `owner-decision`, `operator-capture`).
  Do not extend it without demonstrated need.
- Do not silently demote priority to escape the block.
- Do not duplicate task content into a parallel plan document; the plan lives
  inside the affected tasks themselves (decomposition tasks, refined precondition
  questions, narrowed Done-When sections).
- Preserve owner wording, urgency, and acceptance evidence on every task you
  touch.

## Done When

- Every currently blocked architecture task has been re-examined and either
  carries an actionable, executable unblock step (operator command, decision
  re-ask, or capability probe) or has been decomposed into smaller normalized
  tasks that can advance independently.
- The operator can run a short capture/decision/probe sequence and unblock the
  architecture front without further analysis.
- Acceptance evidence: a single run-directory artifact under `.kota/runs/`
  recording the per-task plan, the operator commands, and the decomposition
  tasks created.

## Source / Intent

2026-04-28 broad daemon review (verbatim): "Autonomy can keep making progress
by seeding small tasks, but the architecture front will not become 'perfect'
while these blockers sit. Desired outcome: Create an operator-facing plan to
clear or decompose the blocked architecture tasks. For owner-decision
blockers, re-ask with concrete recommended answers. For operator-capture
blockers, produce exact commands and artifact paths. For capability blockers,
surface the deterministic probe and next action."

## Initiative

Architecture-front clearing: turn the standing pool of blocked architecture
tasks into a directed unblock plan instead of letting autonomy accumulate
parallel small fan-out work around them.

## Acceptance Evidence

- A run-directory artifact under `.kota/runs/` listing every currently blocked
  architecture task, the chosen unblock action (re-ask / operator capture /
  capability probe / decomposition), and the new sub-tasks created where a
  decomposition was needed.
- Each affected blocked task's `Unblock Precondition` reflects the refined
  action, with concrete `proposed_answers` for owner decisions and explicit
  artifact paths for operator captures.
