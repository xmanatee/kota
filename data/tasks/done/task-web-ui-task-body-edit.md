---
id: task-web-ui-task-body-edit
title: Add inline task body editing to the web UI task panel
status: done
priority: p3
area: web-ui
summary: The task panel lets operators move tasks between states and expand task bodies (read-only markdown), but there is no way to edit the body from the UI. Adding inline editing completes the task management surface without leaving the dashboard.
created_at: 2026-04-02T13:41:47Z
updated_at: 2026-04-08T18:38:00Z
---

## Problem

The web UI task panel supports:
- Creating new tasks (title + summary only)
- Expanding a task row to read its full body (rendered markdown)
- Moving tasks between states (inbox → ready → doing, etc.)

Operators cannot edit a task's title, summary, or body markdown from the UI. To
update a task they must open the file in an editor, change the frontmatter or body,
save, and reload. This is friction for lightweight editorial updates — fixing a typo
in the problem statement, tightening the done-when criteria, or adding a constraint
discovered mid-implementation.

## Desired Outcome

When a task row is expanded, a subtle "Edit" button appears alongside the existing
action buttons. Clicking it replaces the rendered markdown view with a `<textarea>`
pre-filled with the raw body markdown. A "Save" button PATCHes the task body via
a new `PATCH /api/tasks/:id/body` endpoint (or extends the existing task update
endpoint). Cancel reverts to read-only. The frontmatter is not exposed for editing
(state changes remain the dedicated flow).

The server-side handler writes the updated body to the task file while preserving
the existing frontmatter, updates the `updated_at` timestamp, and returns the
saved content.

## Constraints

- Only the markdown body section is editable; frontmatter (status, priority, area,
  etc.) is not surfaced in this editor.
- The save endpoint validates that the task file exists and is in a non-terminal
  state (`done` and `dropped` task files are read-only).
- No rich editor or markdown preview during editing — a plain `<textarea>` is
  sufficient and keeps the implementation in the existing no-dependency style.
- Follow the same server route pattern as `task-routes.ts`; add a test in
  `src/server/task-routes.test.ts`.

## Done When

- Expanded task rows show an "Edit" toggle button.
- Clicking Edit shows a textarea with the raw body; Save persists the change and
  returns to the rendered view; Cancel discards.
- `PATCH /api/tasks/:id/body` (or equivalent) writes the updated markdown body
  while preserving frontmatter, updates `updated_at`, and returns the task record.
- A test covers the new route: valid update, unknown task id, and terminal-state
  rejection.
