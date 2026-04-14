# Workflow Ops Module

This module owns the `kota workflow` CLI surface and the workflow HTTP API routes.

## Internal Structure

- `runs/` — Run inspection: list, show, diff, export, cost, stats, step-inspect, follow, logs, history.
- `definitions/` — Definition inspection and validation: definitions, definition-log, deps, validate.
- `execution/` — Execution and control: run, dry-run, trigger, triggers, control, gc, forecast.
- `routes/` — HTTP API: route wiring and handlers for `/api/workflow/*`.

Shared utilities (`utils.ts`, `definitions-source.ts`) stay at the module root.

## Boundaries

- No change to command names, flags, aliases, or output without updating docs.
- Tests are co-located with the code they cover inside each subdomain.
- HTTP routes are contributed via `routes/routes.ts` using handlers in the same subdirectory.
