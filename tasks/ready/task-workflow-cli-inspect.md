---
id: task-workflow-cli-inspect
title: Finish workflow CLI inspect error display
status: ready
priority: p2
area: cli
summary: `kota workflow show` exists, but plain-text run errors are not displayed reliably because the command tries to read `error.txt` as JSON. The inspect surface is mostly built; the failure path still needs to be finished.
created_at: 2026-03-20
updated_at: 2026-03-25
---

## Problem

The `kota workflow` CLI surface exists, but `kota workflow show` does not reliably surface stored run-level errors for failed runs. The current implementation reads `.kota/runs/<runId>/error.txt` through the JSON reader, so plain-text errors are skipped.

## Desired Outcome

- `kota workflow show <run-id>` displays the run-level error text when `.kota/runs/<runId>/error.txt` exists.
- Failed runs remain debuggable from the CLI without dropping to the filesystem.
- The existing list/status/show surface stays otherwise unchanged.

## Constraints

- Keep the fix narrow to the inspect path.
- Use the existing run directory layout; no new persistence or metadata fields.
- Do not regress the existing list/status/show output.

## Done When

- `kota workflow show <run-id>` prints the stored run-level error when `error.txt` is present.
- A focused test covers the plain-text error path.
- Existing workflow CLI behavior remains intact.
