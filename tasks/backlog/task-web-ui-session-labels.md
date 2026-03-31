---
id: task-web-ui-session-labels
title: Add operator-assigned labels to web UI chat sessions
status: backlog
priority: p3
area: operator-ux
summary: Chat sessions in the web UI are identified only by their UUID, making it impossible to distinguish "debugging run" from "feature exploration" at a glance. Letting operators assign short labels would make session management usable beyond a single tab.
created_at: 2026-03-31T07:37:58Z
updated_at: 2026-03-31T07:37:58Z
---

## Problem

`client-sessions.ts` renders each session as its raw UUID (e.g. `a1b2c3d4`). When an operator has multiple concurrent sessions — or returns to the UI after a day — there is no way to tell which session was used for which purpose without reading the conversation history. Session lists become meaningless beyond 2-3 entries.

## Desired Outcome

Operators can double-click (or click an edit icon beside) a session entry in the sidebar to set a short label. The label is:

- Displayed in place of the raw UUID in the session list.
- Stored in `localStorage` (keyed by session ID) — no server changes required.
- Cleared when the session is deleted.
- Shown in the chat panel header when that session is active.

The raw UUID remains visible as a tooltip or secondary line for debugging.

## Constraints

- Client-side only: no changes to server routes, daemon API, or session storage.
- `localStorage` is acceptable for label persistence; labels are user-preference data, not workflow state.
- The edit interaction should not require a modal — an inline input is preferred.
- Keep changes inside `client-sessions.ts`; avoid growing `client-utils.ts` or `client-chat.ts`.

## Done When

- Session list shows the label when set, UUID when not.
- Clicking/activating the edit flow lets operators type and save a label.
- Label persists across browser refreshes.
- Session deletion clears the stored label.
- `web-ui.test.ts` or a new focused test covers label set/get/clear logic.
