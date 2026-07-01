## Classification Evidence

Implemented deterministic classification for workflow-generated follow-up tasks:

- `security-review` confirmed finding tasks now write `task_class: Safety`.
- `progress-reviewer` generated follow-up tasks now write `task_class` from workflow/area/text classification and include a Product / Safety link for generated Meta tasks.
- Progress-review evidence backfills legacy generated and follow-up task records that lack frontmatter `task_class`, using the task's workflow source or `Follow-up from` source plus area before counting task-class balance.
- `data/tasks/done/task-clear-stale-builder-dlq-items-after-repair-merge.md` now records `task_class: Platform`, and the progress-reviewer fixture covers that exact follow-up source shape.

Focused validation:

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/modules/autonomy/workflows/security-review/workflow.test.ts` passed with 20 tests.
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts` passed with 34 tests, including the `Follow-up from` DLQ regression fixture.
- `pnpm run validate-tasks` passed.
- `pnpm exec biome check src/modules/autonomy/workflow-generated-task-class.ts src/modules/autonomy/workflows/security-review/security-review-tasks.ts src/modules/autonomy/workflows/security-review/workflow-task.test-cases.ts src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts src/modules/autonomy/workflows/progress-reviewer/progress-review/task-evidence.ts src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts` passed.
- `pnpm run typecheck` passed.
