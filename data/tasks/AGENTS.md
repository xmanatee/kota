# Tasks

This directory is the normalized live work queue after ideas leave
`data/inbox/`.

## States

- `backlog/` is triaged work that is not at the front of the queue.
- `ready/` is the short actionable pull queue.
- `doing/` is active work in progress; keep WIP at one task.
- `blocked/` is work that cannot currently move.
- `done/` and `dropped/` are terminal states.

## Task Format

- One task per `task-<slug>.md` file.
- Frontmatter is required: `id`, `title`, `status`, `priority`, `area`,
  `summary`, `created_at`, `updated_at`.
- `id` must match the filename, `status` must match the containing directory,
  and `priority` must be `p0`, `p1`, `p2`, or `p3`.
- Body sections are required: `## Problem`, `## Desired Outcome`,
  `## Constraints`, `## Done When`.
- `## Plan` is optional and should stay high-level.
- Tasks describe what must become true and why it matters; builders own the
  implementation plan.
- Put required research links in `## Resources` or explicit URL/source lines.
  Source-backed tasks are done only when those sources were actually processed.

## Queue Rules

- New rough ideas belong in `data/inbox/`.
- Keep `ready/` short, mixed, and actionable.
- Prefer substantive work over repeated split, rename, dedup, or test-only
  cleanup tasks.
- Keep the queue pointed at module-first/core-shrinking work while visible
  architecture debt remains.
- Do not let open work degrade into only `p3` maintenance.
- Before creating a task, scan open tasks and related inbox items for overlap.
- Update `status` frontmatter whenever moving a task between state directories.
- If required source access fails, move the task to `blocked/` with the blocker
  recorded instead of marking it done from inference.
- Prefer `git mv` for tracked task files, then re-read the moved file before
  editing it.
- Before finishing, ensure task validation would pass: unique ids, tracked task
  files, no stale deletes, and matching status/directories.
