---
id: task-web-ui-keyboard-shortcuts
title: Add keyboard navigation shortcuts to web UI run history and detail panels
status: backlog
priority: p3
area: operator-ux
summary: The web UI has no keyboard shortcuts for navigating run history. Operators reviewing multiple runs must reach for the mouse to open each one; adding j/k navigation and Esc to close the detail panel would speed up routine workflow review.
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Problem

Operators reviewing workflow runs — checking recent failures, comparing costs,
reading step output — must click to open each run, then click Back to return,
then click the next run. On busy instances this is tedious for routine review sessions.

The web UI already uses `EventSource` for live updates and has a run detail panel
(`client-run-detail.ts`), but there are no keyboard shortcuts beyond text-input helpers
(Enter to send, Shift+Enter for newline). Navigation remains pointer-only.

## Desired Outcome

Three keyboard shortcuts improve run review speed:

- `j` / `k` — move selection down/up through the run history list. The selected row is
  highlighted and the run detail panel auto-opens for the selected run.
- `Escape` — closes the run detail panel and returns to the run list.
- `/` — focuses the run history log-search input (already exists in the run detail view).

Shortcuts are suppressed when focus is inside any text input or textarea to avoid
interfering with chat or search input.

## Constraints

- No new dependencies; plain `document.addEventListener("keydown", ...)` is fine.
- Shortcuts must not fire when focus is on an input, textarea, or contenteditable element.
- Add shortcuts in a new `client-keyboard.ts` module following the existing client module pattern.
- No conflict with browser-reserved bindings.

## Done When

- `j`/`k` cycle through run history rows with a visible highlight.
- Selecting a row via `j`/`k` opens the run detail panel.
- `Escape` closes the run detail panel and returns selection to the run list.
- `/` focuses the log-search input when the detail panel is open.
- Shortcuts are suppressed inside text inputs.
- Existing web UI tests pass.
