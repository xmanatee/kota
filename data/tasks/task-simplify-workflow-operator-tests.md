---
status: open
priority: p1
depends_on: [task-simplify-daemon-control-and-scope-tests]
---

# Consolidate workflow operator route, client and CLI verification

## Scope And Evidence

Own `src/modules/workflow-ops` (11,443 test LOC) and `src/modules/daemon-ops`
(6,585), which expose workflow control to operators. Start with
`routes/workflow-routes.test.ts` (1,534), `execution/trial.test.ts` (1,214),
`daemon-client.test.ts` (889) and `execution/dry-run.test.ts` (820).
The route suite hand-builds HTTP/SSE response objects and run metadata; assess
which duplications the real server and run-evidence owners already cover.

## Required Outcome

Trace pause, abort/cancel, retry, retained-run recovery, status and artifact streaming
from the typed client to the production control owner. Retain domain error and
rendering behavior without repeating each server response through route, client,
CLI and simulation. Use controlled transport/process ports and existing fixtures;
do not rebuild coordinator semantics in a trial or simulation fake.

Keep actual public command/HTTP and streaming cancellation observations where they
catch wiring defects. Do not rewrite the control API or duplicate kernel recovery
tests. No state-changing operations against the real running daemon for tests.

## Acceptance

Follow `task-verify-fifty-percent-test-reduction` rules. Publish the reduced
operator portfolio with a concise cross-layer ownership explanation, changed-path
checks and test/support deltas. Preserve visibility of paused, running and
needs-attention states.
