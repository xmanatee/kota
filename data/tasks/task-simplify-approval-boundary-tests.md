---
status: open
priority: p1
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
