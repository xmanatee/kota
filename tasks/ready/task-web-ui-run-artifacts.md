---
id: task-web-ui-run-artifacts
title: Add run artifact detail view to the web UI workflow history panel
status: ready
priority: p3
area: operator-ux
summary: The workflow history panel lists runs but provides no way to inspect what a run produced. Operators need to drill into individual runs to see step outputs, commit messages, and other artifacts left in .kota/runs/.
created_at: 2026-03-31T00:20:16Z
updated_at: 2026-03-31T02:42:57Z
---

## Problem

The workflow run history panel shows per-run metadata (status, cost, duration) but
clicking a run does nothing useful beyond the basic step list. Operators have no
in-browser way to see what a run actually produced: commit messages, files changed,
and structured artifact data. Currently they must `ls .kota/runs/<id>/` in a terminal,
which defeats the purpose of the web UI.

The builder workflow now writes `run-summary.json` to the run directory on every
successful run; it contains `commitSha`, `commitMessage`, `filesChanged`, `taskId`,
and `taskTitle` in a well-known format. This is the primary artifact to surface, but
the detail view should handle other known artifact files too.

## Desired Outcome

The run detail view (already clickable per run) is extended to show artifact file
contents:

- `run-summary.json` if present: display commit SHA, commit message, files changed,
  and task title in a structured summary section at the top of the run detail.
- `commit-message.txt` if present: display alongside or instead of the raw commit
  message field from `run-summary.json`.
- Step output contents: "show more" toggle for outputs currently truncated at 300 chars.
- Any other `.txt` or `.md` artifact files in the run directory, listed with their
  content.

Backed by a new server route `GET /api/workflow/runs/:runId/artifacts` that reads the
run directory and returns a structured list of artifact files and the parsed
`run-summary.json` if present.

## Constraints

- Read-only. No mutation of run artifacts from the UI.
- The new route (`GET /api/workflow/runs/:runId/artifacts`) lives in `workflow-run-routes.ts`
  and is registered in `server-routes.ts`, following the existing route handler pattern.
- Must gracefully handle missing or incomplete run directories (run interrupted before
  writing artifacts).
- No new daemon control API changes — artifacts are read from disk by the server directly.
- Out of scope: binary file preview, live streaming of in-progress step outputs.

## Done When

- The run detail view shows a structured artifact section when `run-summary.json` is
  present, including commit SHA, commit message, and files changed.
- Step output "show more" toggle works for outputs longer than 300 characters.
- `GET /api/workflow/runs/:runId/artifacts` returns the parsed artifact data.
- Basic test coverage for the new route handler.
