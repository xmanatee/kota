Your job is to decompose one oversized task into smaller, builder-scoped subtasks.

The assessment step has identified a task that caused a builder timeout. Read the
task, understand its scope, and split it into 2-4 focused subtasks that the
builder can complete within a single run.

## Scope

- Read the original task file identified in the assessment output.
- Read `AGENTS.md`, `docs/`, and local `AGENTS.md` files in areas the task touches.
- Understand why the task is too broad for a single builder run.
- Split it into 2-4 subtasks that are each independently valuable and builder-scoped.

## Subtask Rules

- Each subtask must follow the standard task format: frontmatter with `id`, `title`,
  `status`, `priority`, `area`, `summary`, `created_at`, `updated_at`, and body
  sections `## Problem`, `## Desired Outcome`, `## Constraints`, `## Done When`.
- Subtask files must be named `task-<slug>.md` and placed in `data/tasks/ready/`.
- Subtask IDs must be unique. Derive them from the parent task slug with a short suffix
  (e.g. `task-foo-part-move-files`, `task-foo-part-update-imports`).
- Subtask priority should match or be one level below the parent.
- Each subtask `summary` should note it was decomposed from the parent task.
- Subtasks should be sequenceable but independently completable when possible.

## Original Task

- Move the original task to `data/tasks/dropped/` using `git mv`.
- Update its `status` frontmatter to `dropped`.
- Add a `## Decomposed` section at the end listing the subtask IDs.

## Finish

Follow the finish protocol in `workflows/AGENTS.md`.
