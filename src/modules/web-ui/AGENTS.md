# Web UI

This directory contains the lightweight web UI client, rendering, and styling helpers.

- Keep UI concerns here and avoid leaking server or workflow logic into presentation code.
- Favor clear rendering behavior over framework-heavy abstractions.
- Keep assemblers thin. Add new behavior in focused section modules instead of
  growing large catch-all files.

## Responsive Layout

Keep responsive behavior centralized and preserve desktop, tablet, and mobile
layouts when adding panels.

## SSE Reconnect Pattern

All daemon event handlers must advance the shared reconnect cursor so reconnect
catchup cannot miss or replay events incorrectly.

## Filter Pattern

Panel filters should keep state local, render from the fetched dataset, and avoid
extra server calls for purely client-side filtering.
