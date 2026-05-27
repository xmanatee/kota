---
id: task-wire-catalog-api-to-order-worker
title: Wire the catalog API route to the order worker
status: ready
priority: p2
area: eval-harness
summary: Align the tiny catalog API and order worker route contract so the local integration command starts both components, exercises the API boundary, and writes machine-readable integration evidence.
created_at: 2026-05-27T00:00:00.000Z
updated_at: 2026-05-27T00:00:00.000Z
---

## Problem

The fixture project has two runtime components: `src/catalog-api.mjs` starts a
local catalog API process, and `src/order-worker.mjs` consumes that API through
a request directory. The worker requests `/api/bundles/starter-kit`, but the
API is still wired to a stale catalog route. The integration command therefore
fails before it can trust the business output.

## Desired Outcome

Make the API and worker agree on the route contract without bypassing either
component. The integration command must start the API, invoke the worker, make
the API request, and write `integration-result.json` with component startup,
request, dynamic-token, and observed-output evidence.

Use this command as the local verification command:

```sh
node scripts/check-integration.mjs
```

## Constraints

- Keep the project dependency-free; use built-in Node.js APIs.
- Do not edit `scripts/check-integration.mjs`; it is the fixture scorer.
- Do not replace the API request with a direct import, hardcoded artifact, or
  summary-only result.
- Keep the implementation change to the service contract source and this
  task's state.
- Do not use network access outside the local API process.

## Done When

- `node scripts/check-integration.mjs` exits successfully.
- The API serves `GET /api/bundles/starter-kit` and the worker consumes it
  through the request directory boundary.
- `integration-result.json` records both `catalog-api` and `order-worker`, the
  request path and status, the dynamic run token, and the expected summary
  line.
- `node scripts/check-integration.mjs --self-test-shortcuts` exits
  successfully, proving hardcoded artifacts and API bypasses are rejected.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/`.

## Acceptance Evidence

- Command output from `node scripts/check-integration.mjs`.
- The generated `integration-result.json` artifact.
- Command output from `node scripts/check-integration.mjs --self-test-shortcuts`.
- The fixture run artifact records the `integration_validation_nodes`
  objective metric.

## Source / Intent

Eval-harness fixture seed for measuring SaaSBench-shaped multi-service builder
work. The point is not to import a benchmark runner; it is to prove through
local artifacts that service startup, route contracts, request flow, and
machine-readable evidence all line up.

## Initiative

Outcome-grade autonomy evaluation: builder quality should include the ability
to make a small multi-component system run end to end, because real coding
work often fails in setup and integration layers before isolated business
logic is reached.
