---
id: task-web-ui-memory-edit
title: Add inline memory entry editing to the web UI memory panel
status: backlog
priority: p3
area: web-ui
summary: The memory panel supports adding and deleting entries but has no way to edit an existing entry's content or tags. Inline editing completes the memory CRUD surface and parallels the knowledge panel edit task.
created_at: 2026-04-08T19:09:14Z
updated_at: 2026-04-08T19:09:14Z
---

## Problem

The web UI memory panel lets operators:
- Add a new memory entry (inline form: content, tags)
- Delete an entry (per-row delete button)
- Expand a row to read the full entry

There is no way to edit an existing entry's content or tags from the UI. The
`MemoryProvider` interface exposes an `update(id, { content, tags })` method, but
no `PATCH /api/memory/:id` server endpoint exists, and the client has no edit form.

Operators who want to correct a memory entry must either delete and re-add it, or
edit the underlying file directly.

## Desired Outcome

When a memory entry row is expanded, an "Edit" button appears alongside the delete
button. Clicking it shows a pre-filled edit form (content textarea, tags input).
A "Save" button calls a new `PATCH /api/memory/:id` endpoint; Cancel returns to
read-only.

The server handler calls `MemoryProvider.update()` in place, preserving the original
`id` and creation timestamp, and returns the saved entry.

## Constraints

- Only content and tags are editable; `id` and creation timestamp are preserved.
- Use the same no-dependency inline form style as the memory add form in `client-memory.ts`.
- The `PATCH` handler must validate that the entry exists; return 404 otherwise.
- Add a test to the existing memory route test file covering: valid update, unknown id.
- No rich editor — plain textarea for content.

## Done When

- Expanded memory entries show an "Edit" button.
- Clicking Edit shows a pre-filled form; Save persists the change and returns to
  read-only; Cancel discards changes.
- `PATCH /api/memory/:id` updates the entry and returns the updated entry.
- Test covers valid update and 404 on unknown id.
