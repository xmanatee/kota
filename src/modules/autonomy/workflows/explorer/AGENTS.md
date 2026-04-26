# Explorer Workflow

This directory contains the explorer workflow definition and prompt.

- This workflow owns external product discovery and roadmap expansion when the local
  queue is otherwise empty or down to a thin tail.
- Study the codebase and relevant outside ideas, but write only under `data/`.
- Keep this workflow focused on high-leverage external discovery, meaningful
  future work selection, and strategic range.
- Keep tasks outcome-focused and concise. This workflow owns the queue contract,
  not the implementation plan.
- Queue counts are lower bounds, not the goal. A healthy queue should not
  collapse into one repeated kind of local work.
- Explorer fires on a thin or empty queue, and its `task-queue-valid` repair
  check requires `data/tasks/ready/` to hold at least one task. When
  `counts.ready` from `inspect-queue` is `0`, either create the new task with
  `--state ready` or promote an existing backlog task with `pnpm kota task
  move <id> ready` before finishing. Do not rely on the repair loop to move
  the task for you — the pattern consistently burns 15–25 minutes of repair
  work per occurrence.
- When `strategicReadyCoverageGap` from `inspect-queue` is `true`, the
  `ready/` queue is non-empty but holds only `p3` work. The run must create
  or promote a `p0`/`p1`/`p2` task before finishing; the
  `strategic-ready-coverage` phase-1 repair check will otherwise force a
  full agent re-run. Same cost profile as the `task-queue-valid` trip above.
- Other task-queue warnings stay advisory.
- The `External Pattern Decisions` catalog in `src/modules/autonomy/AGENTS.md`
  is out of scope for explorer. When a watchlist entry yields a clear
  reject/read/adopt verdict against KOTA's primitives, record it in the
  watchlist `summary` field for that entry — that is explorer's only
  verdict-recording surface. The autonomy AGENTS.md catalog is curated by
  owner distillation or by improver from repeated run evidence; explorer's
  writeScope intentionally excludes it. Two recent occurrences
  (`2026-04-24T14-04-37-931Z-explorer-5qwsga`,
  `2026-04-26T02-06-31-519Z-explorer-0nterp`) burned ~13 min of agent time
  each because the writeScope guard rejected the AGENTS.md edit and aborted
  the whole step with no commit.
