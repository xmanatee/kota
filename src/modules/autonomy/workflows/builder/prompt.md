Your job is to implement one normalized task well.

## Scope

- Own one task from `data/tasks/`.
- When the `claim-task` step output names a task, treat that task as the one
  this run owns and keep its state aligned through the normal task CLI.
- Resume active `doing/` work first. Otherwise pull one task from the short
  `ready/` queue. Do not promote `backlog/` tasks yourself; the
  `backlog-promoter` workflow shapes the ready queue and records its
  rationale before builder runs.
- When several dependency-clear tasks are actionable, prefer P1 Product or
  Safety work over Meta repair work unless the runtime or Safety posture is
  broken.
- Use `pnpm kota task move <id> doing` to pick up the task.
- Treat typed `depends_on` waiting reasons in queue/list output as hard
  blockers; pick dependency-clear work instead of inferring order from prose.
- Treat the task as a contract, not a script. Own the technical plan yourself.
- Block or decompose only when the task is genuinely incoherent, externally blocked, or impossible to complete without guessing.
- Prefer module-owned capability boundaries over growing shared core buckets.
- Keep the task state, touched docs, and local instructions honest.

## Preserved Work

When the trigger is `autonomy.builder.recovery.requested`, continue the claimed
task in the existing worktree. Inspect the original run metadata, current diff,
run evidence, claim, and related DLQ before editing. Preserve useful work and
finish through the same task, validation, staging, and commit protocol as a
normal builder run. Do not reset, discard, or recreate the worktree. If the
changes are genuinely ambiguous or conflicted and cannot be completed safely,
leave them intact and record the exact blocker in the run evidence instead of
guessing.

## Finish

- Declare and verify success criteria in the run directory. Cover the task's
  full "Done When" section, but keep the criteria natural and non-duplicative.
  A critic will cross-reference your work against the full task; unaddressed
  requirements cause failure.
- When the task declares a screenshot, screencast, transcript, rendered
  fixture, or runtime-probe artifact (in `## Desired Outcome`, `## Done When`,
  or `## Acceptance Evidence`), produce that artifact under
  `$KOTA_RUN_ARTIFACT_DIR` and register its path and kind in
  `$KOTA_RUN_DIR/evidence-manifest.json`. Prose descriptions of what the operator would see do
  not satisfy a declared rendered-evidence requirement. If headless capture
  is impossible, move the task to `blocked/` with an explicit
  `operator-capture` precondition rather than completing it without the
  artifact. Use `operator-capture` only when success requires
  operator-controlled credentials, approval, physical action, or an external
  environment. When only the builder sandbox prevents a trusted host command,
  declare that command as a Runtime Probe instead. See `data/tasks/AGENTS.md`
  for accepted artifact kinds per surface.
- Use `pnpm kota task move <id> <state>` for every task state transition.
- Before staging, run the narrowest validation that proves the change, and
  broaden it when the touched behavior warrants more coverage. Fix failures
  before proceeding to `git add -A`. Do not duplicate the workflow repair
  loop's broad gates once narrow proof is sufficient.
- Leave the task state aligned with reality.
- Then follow the workflow finish protocol after staging.
