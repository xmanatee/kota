---
status: done
---

# Consolidate workflow retry and replay route verification at its public owner

## Evidence And Scope

The published audit at `538a5487fca0f0fb124179c269d27aa684128727` found
1,569 test LOC in `src/modules/workflow-ops/routes`, including 1,322 in
`workflow-routes.test.ts`. Its retry and replay sections separately repeat
unavailable-daemon, missing/unsafe run ID, missing-run and active-run setup.
The completed `task-simplify-workflow-operator-tests` reduced broader forwarding
and rendering cases; this task is the remaining request-rejection/handoff slice.

Own that route directory and its directly consumed test helpers. Consult the
client and core admission proofs without reopening their implementations.

## Outcome

Keep one readable owner for genuinely shared request rejection and transport
behavior. Remove demonstrated duplicate scenarios/setup and orphaned support.
Retain distinct retry lineage, original-trigger replay, durable admission handoff,
and artifact/SSE redaction observations. A table may supply inputs and expected
public outcomes; it must not simulate runtime execution.

## Acceptance

Explain which repeated cases share a production decision and which route-specific
faults remain distinct. Run the affected route/client verification, including
unsafe-ID rejection and separate retry/replay handoff oracles. Preserve real wire
proof where it detects an additional transport failure. A listener restriction
is unverified behavior, not a passing result. Stop at this owner boundary; do not
re-audit all workflow-ops or promise a local percentage.

## Verification And Limits

Follow the measurement and shared rules in
`task-reassess-published-fifty-percent-test-reduction`. The 50% minimum belongs
to the aggregate, not this slice. Preserve necessary behavior and readable tests;
a demonstrated no-change decision is valid. No displacement into helpers,
snapshots, fixtures, generated outputs, renamed or disabled tests. Report test,
support, exclusion and production deltas separately. Use family-level admission
reasoning and representative retained/deleted examples, not per-assertion records
or a new scenario interpreter. Reuse valid prior proof and report limitations.

## Completion

Consolidated shared request rejection and source-trigger handoff setup in the public
route suite. Both handlers retain unsafe-ID and missing-run rejection, with explicit
no-dispatch assertions. Separate retry/replay handoff expectations preserve source
schema, scope and lineage. Active retry still reaches durable admission; active
replay rejects before enqueueing. Removed the redundant interrupted-evidence handoff
instance; successful evidence remains to protect admission ownership. Artifact/SSE
observations, production behavior and existing wire verification are unchanged.

Frozen-recipe local route test LOC: 1,569 -> 1,542 (workflow-routes.test.ts:
1,322 -> 1,295). Support and exclusion deltas are zero; production remains 1,264 LOC.
No support was added or displaced. These candidate counts do not establish the
parent audit's published aggregate target.

Validation: 129 route/client/retrigger tests and 24 durable admission/transport tests
passed. The static gate passed. The unchanged real HTTP/SSE reconnect journey was
attempted but failed at loopback listen with EPERM before wire assertions; wire
behavior remains unverified here. This test-only consolidation retains that proof
and has passing scoped behavioral checks; no complete release-suite pass is claimed.

Run 2026-09-12T20-00-34-671Z-builder-g1brqt stores family-level ownership reasoning,
per-file measurements, and verification logs in its ordinary agent artifacts.
