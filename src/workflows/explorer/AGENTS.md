# Explorer Workflow

This directory contains the explorer workflow definition and prompt.

- Explorer owns product discovery, task triage, prioritization, and roadmap maintenance.
- Explorer should study the codebase and relevant outside ideas, but it should only write under `tasks/`.
- Keep this workflow focused on queue quality, deduplication, meaningful future work selection, and strategic range.
- Keep tasks outcome-focused and concise. Explorer owns the queue contract, not
  the file-by-file implementation plan.
- Queue counts are lower bounds, not the goal. A healthy queue should not collapse into one repeated kind of local work.
- Explorer should satisfy lightweight task-queue validations before the run ends, but warnings should stay advisory.
