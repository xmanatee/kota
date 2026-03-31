---
id: task-web-ui-run-artifacts
title: Add run artifact detail view to the web UI workflow history panel
status: backlog
priority: p3
area: operator-ux
summary: The workflow history panel lists runs but provides no way to inspect what a run produced. Operators need to drill into individual runs to see step outputs, commit messages, and other artifacts left in .kota/runs/.
created_at: 2026-03-31T00:20:16Z
updated_at: 2026-03-31T00:20:16Z
---

## Problem

The workflow run history panel shows per-run metadata (status, cost, duration) but
clicking a run does nothing. Operators have no in-browser way to see what a run
actually produced: which steps ran, what each step returned, whether a commit message
was written, or what files changed. Currently they must `ls .kota/runs/<id>/` in a
terminal, which defeats the purpose of the web UI.

## Desired Outcome

Clicking a run in the history panel opens a detail view (modal or expanded row) that
shows:

- Per-step status (completed / failed / skipped) and duration.
- Step output contents, rendered as plain text (truncated with a "show more" toggle for
  large outputs).
- `commit-message.txt` if present, displayed prominently.
- Any other `.txt` or `.md` artifact files in the run directory, listed with their
  content.

Backed by a new daemon control API endpoint `GET /workflow/runs/:runId/artifacts` that
reads the run directory and returns a structured list of artifact files.

## Constraints

- Read-only. No mutation of run artifacts from the UI.
- Endpoint must gracefully handle missing or incomplete run directories (e.g. a run
  that was interrupted before writing any artifacts).
- Follows existing panel patterns (Lit components, SSE where appropriate, no
  framework additions).
- New endpoint documented in `docs/DAEMON-API.md`.
- Out of scope: binary file preview, live streaming of in-progress step outputs (a
  separate task).

## Done When

- Clicking a run in the history panel shows per-step results and any artifact file
  contents.
- `GET /workflow/runs/:runId/artifacts` returns structured data and is documented.
- Basic test coverage for the new endpoint.
