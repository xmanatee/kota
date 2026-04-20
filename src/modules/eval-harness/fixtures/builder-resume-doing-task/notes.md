# builder-resume-doing-task

## Source

- Run id: `2026-04-18T07-43-01-839Z-builder-hczmv9` (the failure)
- Workflow: `builder`
- Task claimed mid-flight: `task-source-channel-level-autonomy-defaults-from-config`
- Follow-on recovery run: `2026-04-18T08-19-15-617Z-builder-1l1f9s`
  (trigger `runtime.recovered`, see its `trigger.json` — the recovered
  worktree summary names the task renamed from `ready/` to `doing/` plus
  15+ modified files left uncommitted).

## What failed

The builder claimed the task, moved its file from `ready/` to `doing/`,
began implementation, and then the `build` step timed out after
2,171,273 ms (see `steps/build.json`: `"error": "Step \"build\" timed
out after 2100000ms"`). The work was never committed, so the task file
sat in `doing/` while the worktree was dirty with 15+ unstaged edits —
the exact stranded-doing shape that drove commits `82057df2` (auto-reset
dirty worktree with stranded doing tasks), `d6036f72` (status/directory
mismatch after rescue), `61e1e7d8` (recover-doing-tasks improver step),
and later the prompt-level prereq scan in `2e96acf2`. The recovery run
`builder-1l1f9s` had to reset the worktree before it could make forward
progress.

The regression this fixture exists to catch is the next builder's
pickup decision on a `doing/` file: if it ignores `doing/` and pulls
from `ready/` instead, mid-flight work is abandoned and the system
re-enters the same stranded-doing cycle.

## Why this fixture captures it

The `initial/` tree puts one task directly in `doing/` (matching the
post-timeout repo state on 2026-04-18 08:19) and a decoy in `ready/`.
Predicates check that the `doing/` task moved to a terminal state, that
its marker file exists, and that the decoy in `ready/` remains
untouched. A builder that skips `doing/` and pulls the decoy fails at
least one predicate, reproducing the stranded-doing failure shape at
the harness layer instead of via a live timeout.
