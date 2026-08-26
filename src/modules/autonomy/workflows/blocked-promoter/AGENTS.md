# Blocked Promoter

Evaluates typed unblock preconditions and moves tasks whose blockers have
cleared.

- This code-only workflow declares repository write access and task validation.
  Shared runtime owns its sandbox, recovery, commit, and publication.
- Never move terminal tasks. Use repo-tasks domain operations for every state
  transition.
- The writer emits a stable owner-decision request only after integration.
  `blocked-promoter-owner-decision` owns `askOwnerSteps` on a separate
  `repository: none` follow-up, then emits a stable resolution for a new writer
  run to apply.
- Tests cover deterministic promotion, owner-decision resume, terminal-task
  rejection, and observable task state. Await-event restart behavior belongs to
  the shared workflow runtime tests.
