---
id: task-web-ui-knowledge-edit
title: Add inline knowledge entry editing to the web UI knowledge panel
status: done
priority: p3
area: web-ui
summary: The knowledge panel supports adding and deleting entries but has no way to edit an existing entry's title, content, or tags. Inline editing completes the knowledge CRUD surface without leaving the dashboard.
created_at: 2026-04-02T14:18:25Z
updated_at: 2026-04-08T19:09:14Z
---

## Problem

The web UI knowledge panel lets operators:
- Add a new entry (inline form: title, type, tags, content)
- Delete an entry (per-row delete button)
- Expand a row to read the full entry

There is no way to edit an existing entry's title, content, or tags from the UI.
Operators who want to correct a typo, update a summary, or retag an entry must edit
the underlying markdown file directly. This is friction for a surface designed to be
the primary knowledge management interface.

The server currently has `GET /api/knowledge/:id`, `POST /api/knowledge`, and
`DELETE /api/knowledge/:id` but no `PATCH` endpoint for updates.

## Desired Outcome

When a knowledge entry row is expanded, an "Edit" button appears alongside the
delete button. Clicking it replaces the read view with a pre-filled edit form
(title, type, tags, content textarea). A "Save" button calls a new
`PATCH /api/knowledge/:id` endpoint; Cancel returns to read-only.

The server handler updates the entry file in place, preserving the original `id`
and `created` timestamp, updating the `updated` timestamp, and returning the
saved entry.

## Constraints

- Only title, type, tags, and content are editable; `id` and `created` are preserved.
- Use the same no-dependency inline form style as the add form in `client-knowledge.ts`.
- The `PATCH` handler must validate that the entry exists; return 404 otherwise.
- Add a test to the existing knowledge route test file covering: valid update, unknown id.
- No rich editor — plain textarea for content, same as the add form.

## Done When

- Expanded knowledge entries show an "Edit" button.
- Clicking Edit shows a pre-filled form; Save persists the change and returns to the
  read view; Cancel discards changes.
- `PATCH /api/knowledge/:id` updates the entry file, updates `updated_at`, and returns
  the updated entry.
- Test covers valid update and 404 on unknown id.
