# Workflow Extension

This extension owns the `kota workflow` CLI surface.

- All `kota workflow` subcommands live here: run, list, show, step-inspect, follow, trigger, control (pause/resume/abort/reload), validate, definitions, logs, gc, export, diff, cost, stats.
- No change to command names, flags, aliases, or output without updating docs.
- Tests for CLI commands and formatting utilities are co-located here.
