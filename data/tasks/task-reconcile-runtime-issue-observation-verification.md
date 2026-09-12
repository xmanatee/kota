---
status: open
priority: p1
---

# Reconcile runtime issue observation and attribution verification

## Evidence And Scope

The audit of published `eb41e8e7c8b0509e8e33cc074f6baa0e950ba4eb`
reproduces two failures in `src/modules/autonomy/autonomy-issue-runtime-sources.test.ts`:

- Partially dismissing three of four related dead letters emits three `cleared`
  observations after four `present` observations, while the test expects only
  the four `present` observations. Its later issue-lifetime oracle is not reached.
- Typed runtime failure versus reconciled failure attribution differs:
  `contract/unattributed` and `trigger/unattributed` replace the expected contract
  digest and `trigger/autonomy.queue.available`.

These are assertion mismatches without an observed sandbox error. Do not label
them environmental or delete them to meet the reduction goal. Own the runtime
issue-source adapter, its projection consumer and this test. Consult the existing
core dead-letter and run metadata contracts; do not redesign those owners or
reopen all autonomy workflows.

## Outcome And Acceptance

Determine the intended per-item signal versus aggregate issue lifecycle from
current production owners. Keep a related incident actionable while an unresolved
canonical member remains, clear it only on the correct aggregate transition, and
preserve attributable workflow/trigger/contract identity across typed-event and
reconciliation paths. Reject invented attribution when evidence is absent.

Repair production or stale fixtures at the owning boundary, with one public
observation for each distinct behavior. Exercise partial/final dismissal,
reconciliation/restart and missing metadata through the real store/projector.
Do not assert a private signal count in place of the resulting issue state.
Report whether each failure was a behavior defect or an outdated proof.

## Provenance And Measurement

Run `2026-09-12T22-32-50-597Z-builder-67j7si` retains
`triage-more-results.json` and `assertion-triage.log`, including exact expected
and received values. Follow the shared rules in
`task-assess-fifty-percent-reduction-after-citation-and-reminder-followups`;
report test, support, exclusions and production separately. This is a bounded
correctness/proof repair, with no deletion quota or live-model dependency.
