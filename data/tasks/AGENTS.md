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
- Open tasks also require `## Source / Intent` and
  `## Acceptance Evidence`. `p0`/`p1`/`p2` open tasks require
  `## Initiative`.
- `## Plan` is optional and should stay high-level.
- Tasks describe what must become true and why it matters; builders own the
  implementation plan.
- Preserve owner wording, runtime evidence, research source, and urgency in
  `## Source / Intent`; do not normalize away the reason the task exists.
- `## Initiative` names the larger product, architecture, or autonomy outcome
  so strategic work does not degrade into isolated micro-commits.
- `## Acceptance Evidence` names the transcript, screenshot, fixture, command,
  artifact, or demo that proves the task's outcome. User-facing CLI/UI work
  needs rendered-output evidence, not only implementation tests.
- Keep required research links visible when they are central to the work.

## Blocked Task Preconditions

Every task in `blocked/` declares one typed unblock precondition in a
`## Unblock Precondition` body section so the autonomy loop can re-evaluate
the block instead of waiting on human re-review. The vocabulary is small and
extends only on demonstrated need:

- `task-done` — the named enabler task must sit in `data/tasks/done/`. Use
  this whenever one blocked task is genuinely waiting on another to land.
- `capability-installed` — a named deterministic probe must succeed.
  Recognized probes: `playwright` (the `playwright` package resolves) and
  `storageState:<repo-relative path>` (the file at the path exists). Probes
  read repo state only — no network.
- `owner-decision` — a named decision slot the owner must resolve. The
  `blocked-promoter` workflow re-asks through `askOwnerSteps` on a 14-day
  cadence; an `unblock` answer (or any approval keyword in the
  precondition's `proposed_answers` list) writes a resolved marker that
  promotes the task on the next cycle.
- `operator-capture` — a named operator-facilitated artifact must exist at
  the given path (literal or simple `*` glob). The promoter never auto-asks
  for this kind; `attention-digest` surfaces aging entries past 14 days.

`p0`/`p1` work whose precondition fires moves to `ready/`; everything else
moves to `backlog/`. The promoter never touches `done/` or `dropped/` and
never acts on a dirty worktree. Malformed or missing preconditions are a
hard validation error (`blocked-task-precondition-invalid`).

## Queue Rules

- New rough ideas belong in `data/inbox/`.
- Keep `ready/` short, mixed, and actionable.
- Prefer substantive work over repeated split, rename, dedup, or test-only
  cleanup tasks.
- Keep the queue pointed at module-first/core-shrinking work while visible
  architecture debt remains.
- Do not let open work degrade into only `p3` maintenance.
- Before creating a task, scan open tasks and related inbox items for overlap.
- Prefer coherent batches or one substantive task over isolated mechanical
  move/import/test-only work. If cleanup is needed, attach it to the broader
  initiative it enables.
- Owner-facing regressions, broken operator output, repeated expensive
  failures, and stale blocked owner requests are strong queue-shaping signals.
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
