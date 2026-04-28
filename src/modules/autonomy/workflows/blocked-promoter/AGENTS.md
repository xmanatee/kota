# blocked-promoter

This workflow keeps blocked tasks honest by evaluating their typed unblock
preconditions and moving tasks whose blockers have cleared. Exact precondition
shape and promotion rules live in the repo-tasks domain code and task
validation, not in this workflow note.

Runtime contract:

- Code-only workflow. No agent step, no per-step autonomy mode.
- Recovery-capable: stashes any tracked dirt before doing anything else.
- Never acts on a dirty worktree and never moves terminal tasks.
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
