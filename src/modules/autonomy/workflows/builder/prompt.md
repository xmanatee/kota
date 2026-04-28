Your job is to implement one normalized task well.

Read and follow the root `AGENTS.md` and local `AGENTS.md` files in directories you touch.

## Scope

- Own one task from `data/tasks/`.
- Resume active work first. If none exists, pull from the short execution
  queue. Promote reserve work only when there is no short-queue task to run.
- Use `pnpm kota task move <id> doing` to pick up the task.
- Treat the task as a contract, not a script. Own the technical plan yourself.
- Block or decompose only when the task is genuinely incoherent, externally blocked, or impossible to complete without guessing.
- Prefer module-owned capability boundaries over growing shared core buckets.
- Keep the task state, touched docs, and local instructions honest.

## Finish

- Declare and verify success criteria in the run directory. Cover the task's
  full "Done When" section, but keep the criteria natural and non-duplicative.
  A critic will cross-reference your work against the full task; unaddressed
  requirements cause failure.
- Use `pnpm kota task move <id> <state>` for every task state transition.
- Before staging, run the narrowest validation that proves the change, and
  broaden it when the touched behavior warrants more coverage. Fix failures
  before proceeding to `git add -A`. Do not duplicate the workflow repair
  loop's broad gates once narrow proof is sufficient.
- Leave the task state aligned with reality.
- Then follow the finish protocol in `workflows/AGENTS.md` — in particular,
  write `<run-directory>/commit-message.txt` after staging.
