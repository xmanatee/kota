---
id: task-workflow-run-log-search
title: Add full-text search to workflow run logs in CLI and web UI
status: ready
priority: p2
area: operator-ux
summary: Operators have no way to search through workflow run output. Finding a specific error, tool call, or agent message requires manually scrolling through all log lines. Full-text search on run output would make debugging multi-hour runs practical.
created_at: 2026-03-31T13:43:00Z
updated_at: 2026-03-31T14:10:00Z
---

## Problem

`kota workflow logs <run-id>` streams all log lines. The web UI run detail panel similarly renders the full output. When a run has hundreds or thousands of lines — typical for long builder or explorer runs — finding a specific error message, file name, or tool invocation means reading everything. There is no `--grep` flag on the CLI or search input in the web UI.

## Desired Outcome

**CLI**: `kota workflow logs <run-id> --grep <pattern>` filters output to matching lines plus `--context N` surrounding lines (default 3), following `grep -C` semantics.

**Web UI**: A search input above the log panel filters visible lines in real time (client-side filter, no server round-trip). Matches are highlighted. The input is cleared by pressing Escape.

The CLI implementation should use a simple substring or regex match against the raw log line text; it does not need full-text indexing.

## Constraints

- CLI: `--grep` accepts a literal string; add `--regex` flag to opt into regex mode.
- CLI: `--context` (or `-C`) defaults to 3; 0 means matching lines only.
- Web UI: client-side filter only — no server changes required.
- No new persistence layer or indexing; filter at read/render time.
- The existing `kota workflow logs --follow` mode should pass through unfiltered (filtering a live stream is out of scope).

## Done When

- `kota workflow logs <run-id> --grep <text>` returns only matching lines with context.
- `kota workflow logs --grep --regex` supports regex patterns.
- The web UI log panel has a working search input that highlights matches.
- Existing workflow log tests pass.
- `kota workflow logs --help` documents the new flags.
