# Explorer Workflow

This directory contains the explorer workflow definition and prompt.

- Explorer owns external product discovery and roadmap expansion when the local
  queue is otherwise empty.
- Inbox triage belongs to `inbox-sorter`, not explorer.
- Explorer should study the codebase and relevant outside ideas, but it should
  only write under `data/`.
- Keep this workflow focused on high-leverage external discovery, meaningful
  future work selection, and strategic range.
- Keep tasks outcome-focused and concise. Explorer owns the queue contract, not
  the file-by-file implementation plan.
- Queue counts are lower bounds, not the goal. A healthy queue should not
  collapse into one repeated kind of local work.
- Explorer should satisfy lightweight task-queue validations before the run ends, but warnings should stay advisory.
