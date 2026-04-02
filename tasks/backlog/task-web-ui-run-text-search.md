---
id: task-web-ui-run-text-search
title: Add free-text search to the web UI run history filter
status: backlog
priority: p3
area: web-ui
summary: The web UI run history already supports workflow, status, tag, and date filters, but operators cannot search by run ID substring or error text. A text box filter would let operators quickly locate a specific run without knowing its exact metadata.
created_at: 2026-04-02T09:32:00Z
updated_at: 2026-04-02T09:32:00Z
---

## Problem

The run history panel has dropdown filters for workflow name, status, tag, and a date
range picker. These cover structured metadata well, but operators often want to find a
run by:

- A partial run ID (e.g., the last few characters of a known run)
- A trigger event name
- A substring of the error text visible in the run summary

Currently the only option is to scroll through the list or use `kota workflow list -w`
from the CLI with exact filters.

## Desired Outcome

A text input field in the run history filter row that matches against:

- Run ID (substring match)
- Workflow name (substring match, for when the dropdown isn't convenient)
- Trigger event name

The match is applied client-side against the already-loaded `_allRecentRuns` array,
following the same pattern as the existing `applyHistoryFilter` function.

The text box clears with an ×-button and debounces input at ~200ms.

## Constraints

- Client-side only; no new API calls.
- Composes with existing filters (all active filters apply simultaneously).
- Debounced to avoid excessive re-renders when typing.
- Does not need to search inside step outputs or error messages — only surface-level
  run metadata (id, workflow, triggerEvent).

## Done When

- A text search input appears in the filter row.
- Typing filters the visible run list by run ID, workflow name, or trigger event.
- The text filter composes correctly with the workflow, status, tag, and date filters.
- Clearing the text box restores the full filtered list.
- Manual verification: searching for a known partial run ID shows only that run.
