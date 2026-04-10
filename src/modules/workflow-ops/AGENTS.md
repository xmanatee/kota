# Workflow Ops Module

This module owns the `kota workflow` CLI surface and the workflow HTTP API routes.

- All `kota workflow` subcommands live here: run, list, show, step-inspect, follow, trigger, control (pause/resume/abort/reload), validate, definitions, logs, gc, export, diff, cost, stats.
- No change to command names, flags, aliases, or output without updating docs.
- Tests for CLI commands and formatting utilities are co-located here.
- HTTP routes for `/api/workflow/*` and `/api/workflow/runs/*` are contributed via `routes.ts` using handlers in `workflow-routes.ts` and `workflow-run-routes.ts`.
