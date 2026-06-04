# Workflow Ops Module

This module owns the `kota workflow` CLI surface, its `kota automation` authoring
alias, and the workflow HTTP API routes.

## Internal Structure

- `runs/` — Run inspection: list, show, diff, export, cost, stats, step-inspect, follow, logs, history.
- `definitions/` — Definition inspection and validation: definitions, definition-log, deps, validate.
- `execution/` — Execution and control: run, dry-run, trigger, triggers, control, gc.
- `routes/` — HTTP API: route wiring and handlers for `/api/workflow/*`.

Shared utilities (`utils.ts`, `definitions-source.ts`) stay at the module root.

## Boundaries

- No change to command names, flags, aliases, or output without updating docs.
- Do not add a second automation client namespace. Operator-facing labels may
  say automation or hook, but commands and clients still route through the
  workflow contract and workflow run store.
- Tests are co-located with the code they cover inside each subdomain.
- HTTP routes are contributed via `routes/routes.ts` using handlers in the same subdirectory.

## KotaClient Surface

The `workflow` namespace contract lives in `client.ts` (`WorkflowClient`,
result/option types, and the `buildTriggerHttpPayload` reshape helper).
`localClient(ctx)` and `daemonClient(link)` factories in `index.ts` realize
the contract; `buildWorkflowDaemonHandler(link)` is the daemon-side factory
that routes the thirteen namespace methods through the typed
`DaemonTransport`. Wire paths and reshape semantics are pinned in
`daemon-client.test.ts`.
