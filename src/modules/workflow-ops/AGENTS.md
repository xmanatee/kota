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
- The module's live UI source owns run/automation projection and controls;
  related approval, question, and session reads remain typed client calls.
- Tests are co-located with the code they cover inside each subdomain.
- HTTP routes are contributed via `routes/routes.ts` using handlers in the same subdirectory.
- `workflow resume` changes dispatch pause only. Clearing provider or
  authentication backoff requires the explicit `--retry-agent` option after
  the operator has fixed its cause.

## KotaClient Surface

The `workflow` namespace contract lives in `client.ts` (`WorkflowClient` and
result/option types). Core owns canonical queued-run and wire-trigger assembly.
`localClient(ctx)` and `daemonClient(link)` factories in `index.ts` realize
the contract; `buildWorkflowDaemonHandler(link)` is the daemon-side factory
that routes the thirteen namespace methods through the typed
`DaemonTransport`. Trigger event, schema, payload, run id, and eligibility must
have identical semantics on both paths. Wire paths and reshape semantics are
pinned in `daemon-client.test.ts`.
