---
id: task-web-ui-history-view
title: Make history items in web UI clickable to view conversation
status: ready
priority: p2
area: web-ui
summary: The sidebar history panel renders conversation titles but clicking does nothing. The API already supports GET /api/history/:id returning full message content. Clicking a history entry should display the conversation in the main chat area as a read-only view.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

The history panel in the web UI shows up to 15 recent conversation titles,
but history items have no click handler. The backend already exposes
`GET /api/history/:id` which returns `{ messages, title, id, updatedAt }`.
The feature is 90% built — only the client-side view is missing.

## Desired Outcome

- Clicking a history item loads `GET /api/history/:id` and renders the
  conversation messages in the chat area.
- The view is read-only: the input area is hidden (or disabled with a note).
- A back button or clicking "New chat" returns to the normal chat state.
- The active history item is highlighted in the sidebar while viewing.
- Messages are rendered using the existing `renderMarkdown` / `escapeHtml`
  utilities so formatting is consistent with live chat.

## Constraints

- No new server routes needed — `GET /api/history/:id` already exists.
- Do not allow sending messages in history view (read-only).
- Reuse the existing message DOM structure and CSS classes.

## Done When

- Clicking a history item loads and displays its messages.
- Read-only mode prevents accidental sends.
- No regressions in existing chat or workflow UI behavior.
- Tests cover the new `GET /api/history/:id` client call path.
