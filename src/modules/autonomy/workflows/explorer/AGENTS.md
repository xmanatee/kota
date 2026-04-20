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
- Other task-queue warnings stay advisory.
