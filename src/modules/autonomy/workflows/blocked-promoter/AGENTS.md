# blocked-promoter

This workflow keeps `data/tasks/blocked/` honest. Each cycle it:

- Reads every blocked task's typed `## Unblock Precondition` (parser lives in
  `src/modules/repo-tasks/blocked-precondition.ts`).
- Auto-promotes any blocked task whose `task-done`, `capability-installed`,
  or `operator-capture` precondition is satisfied right now. `p0`/`p1` work
  goes to `ready/`; everything else to `backlog/`.
- Re-asks the oldest `owner-decision` precondition that has not been asked
  in the last 14 days, using the `askOwnerSteps` recipe so the wait is
  restart-safe. The 14-day cadence is tracked through
  `<!-- blocked-promoter-asked: slot=... last_asked_at=... -->` markers
  written into the task body.
- Recognizes the operator's approval — the literal `unblock` answer (or any
  answer in the precondition's `proposed_answers` list that matches an
  approval keyword) — and writes a
  `<!-- blocked-promoter-resolved: slot=... resolved_at=... -->` marker so
  the same cycle (and any later cycle) can promote the task.

Runtime contract:

- Code-only workflow. No agent step, no per-step autonomy mode.
- Recovery-capable: stashes any tracked dirt before doing anything else.
- Never touches `done/` or `dropped/`. Never acts on a dirty worktree.
- The askOwnerSteps recipe is the only outward call; everything else is
  deterministic file operations and `git mv` via the shared
  `moveTaskById` helper.

## Regression coverage

`owner-decision-cycle.integration.test.ts` is the load-bearing regression
for the full owner-decision unblock cycle: ask → daemon-restart → free-form
Telegram chat reply → resolved-marker → auto-promote. It drives the real
`blocked-promoter` workflow, the `askOwnerSteps` recipe, the
`OwnerQuestionQueue`, the `installAwaitResumers` resume path, and the
`tryHandleOwnerQuestionReply` chat-reply path through a real `Daemon`
stop/start cycle. A regression in any one of those four named seams fails
this single test with a message naming the broken seam.
