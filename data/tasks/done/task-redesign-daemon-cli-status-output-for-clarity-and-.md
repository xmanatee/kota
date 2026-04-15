---
id: task-redesign-daemon-cli-status-output-for-clarity-and-
title: Redesign daemon CLI status output for clarity and extensibility
status: done
priority: p2
area: cli
summary: The daemon status display mixes raw IDs, full timestamps, inconsistent alignment, and noisy details. Redesign it for clean terminal presentation with proper layout, relative times, and a path toward interactivity.
created_at: 2026-04-15T12:46:18.187Z
updated_at: 2026-04-15T13:21:42.142Z
---

## Problem

The `kota daemon` status display (the banner shown on startup and via `kota daemon status`) has several UX issues:
- Raw run IDs and full ISO timestamps clutter the output.
- Cost and stat values collide with adjacent labels (e.g. `$1470.04Defs`).
- No adaptation to terminal width — long dirty-file lists overflow.
- The startup log and the status banner are interleaved without clear separation.
- The previous rich-dashboard task (`task-rich-daemon-cli-dashboard-output`, done) improved the live dashboard, but the static status banner and log interleaving remain rough.

The owner wants the output to be clean, informative, and on a path toward interactive controls.

## Desired Outcome

- Clean status banner: relative times, abbreviated IDs, proper column alignment, terminal-width-aware truncation.
- Clear visual separation between the status summary and the streaming log.
- Dirty-worktree file lists are collapsed/summarized with an expand option or truncated with a count.
- Research viable approaches for future interactivity (scrollable log, keyboard controls) and pick a library/approach that does not require a rewrite later.
- May be split into sub-tasks if the scope warrants it.

## Constraints

- Non-TTY output must remain machine-readable (existing `--log-format json` and `--log-format text` modes unchanged).
- The `DaemonLogger` contract should not change.
- Must work correctly on standard macOS Terminal.app and common emulators (iTerm2, Warp, kitty).

## Done When

- The daemon status banner renders cleanly with relative times, aligned columns, and no raw UUIDs in the default view.
- Startup log and status are visually distinct.
- Long file lists are summarized rather than dumped inline.
- The chosen approach is compatible with adding interactive controls later.
