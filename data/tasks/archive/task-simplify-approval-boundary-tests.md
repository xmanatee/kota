---
status: done
---

# Simplify approval verification while retaining action authorization proofs

## Scope

`src/modules/approval-queue` retains 8,115 test LOC across 37 files. Inspect queue,
decision application, routes, CLI and UI adapters against the existing approval
and owner-decision stores. Do not merge unrelated approval and owner-question
semantics just because their record shapes resemble one another.

## Required Outcome

Keep each authorization, expiry, replay, scope-binding and destructive-action
failure at its actual owner. Remove repeated state-machine matrices through
route/CLI/UI consumers and copied private record fixtures. Keep representative
operator wiring and an actual approved/denied effect path; compiler types do not
prove authorization or exactly-once action disposition.

Use real stores with controlled time/action ports and existing authenticated
record helpers. Simplify adjacent duplicated behavior only through its owner.
Do not replace security checks with snapshots, mocks that predetermine decisions,
or unconditional approval shortcuts.

## Acceptance

Follow `task-verify-fifty-percent-test-reduction` rules. Publish a focused
approval-boundary cleanup, retained failure rationale and test/support deltas.
Use existing meaningful denial/replay observations; do not add a fault matrix
for every UI consumer.

## Completion

Consolidated duplicate route/control/client cases and reused existing HTTP and
receipt helpers in three security suites. Real queue, MCP race, execution lease,
scope isolation, expiry and authenticated-action owners remain intact. Retained
approval and denial paths now explicitly observe replay and runner call counts.
CLI/UI authorization semantics and production code are unchanged.

Local frozen-recipe test LOC: 4,315 → 3,811 (504 removed, 11.68%); 17 test files
remain. Authored support: 196 → 196; production and exclusions: zero delta.
Existing unclassified test-tool helpers remain 285 LOC. This is the candidate
slice; the parent task still owns published aggregate acceptance.

Validation: check:fast passed; 183 distinct focused owner tests passed across the
main run and corrected route rerun, covering real stores, expiry, integrity,
denial, replay, scope binding and MCP execution. Nine retained HTTP tests could
not bind a listener in the sandbox. One full-runtime gate test timed out in both
candidate and original HEAD; it remains enabled. Final changed-file Biome and
diff whitespace checks passed. Full release/live/native-client checks were not
run for this test-only change.

Run 2026-09-12T06-41-15-602Z-builder-9mxp52 retains approval-summary.md,
approval-before.json, approval-deltas.json and validation logs with the removed
and retained failure rationale. Publication remains runtime-owned.
