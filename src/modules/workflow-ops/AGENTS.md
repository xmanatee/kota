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
- `workflow resume` changes dispatch pause only. The explicit `--retry-agent`
  option clears a corrected quality/output pause; provider and authentication
  incidents remain parked until their recorded recovery horizon elapses.
- Material canary quality regressions use the agent-only quality-pause control.
  They persist in the shared backoff authority and leave deterministic workflow
  dispatch available until an explicit agent retry. That retry clears the
  quality pause but preserves any provider reset horizon that is still active.
- workflow exec is the eval-harness subprocess boundary. Its paired
  --agent-harness / --agent-model override may also carry --agent-effort so
  model-matrix runs execute the requested runtime facts instead of merely
  labelling the result. Standalone execution is limited to positively
  identified eval-harness roots; canonical execution uses the scoped daemon
  workflow client and fails closed when daemon authority is unavailable.

## KotaClient Surface

The `workflow` namespace contract lives in `client.ts` (`WorkflowClient` and
result/option types). Core owns canonical queued-run and wire-trigger assembly.
`localClient(ctx)` and `daemonClient(link)` factories in `index.ts` realize
the contract; `buildWorkflowDaemonHandler(link)` is the daemon-side factory
that routes the namespace methods through the typed
`DaemonTransport`. Trigger event, schema, payload, run id, and eligibility must
have identical semantics on both paths. Wire paths and reshape semantics are
pinned in `daemon-client.test.ts`.
