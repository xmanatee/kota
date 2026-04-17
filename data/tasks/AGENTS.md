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
- Keep required research links visible when they are central to the work.

## Queue Rules

- New rough ideas belong in `data/inbox/`.
- Keep `ready/` short, mixed, and actionable.
- Prefer substantive work over repeated split, rename, dedup, or test-only
  cleanup tasks.
- Keep the queue pointed at module-first/core-shrinking work while visible
  architecture debt remains.
- Do not let open work degrade into only `p3` maintenance.
- Before creating a task, scan open tasks and related inbox items for overlap.
- Use `pnpm kota task move <id> <state>` to move tasks between state directories.
  This auto-updates the `status` frontmatter, sets `updated_at`, runs `git mv`,
  and stages the result. Do not manually move task files or edit status
  frontmatter — the CLI handles both atomically.
- If required source access fails (auth-walled, HTTP 4xx, paywall, fetch
  failure), do not mark the task done. Move it to `blocked`, create a follow-up
  or enabler task, or document why the source is no longer needed. A done task
  that records inaccessible sources without honest handling is a validation
  error (`done-task-inaccessible-source`).
- Before finishing, ensure task validation would pass: unique ids, tracked task
  files, no stale deletes, and matching status/directories.
