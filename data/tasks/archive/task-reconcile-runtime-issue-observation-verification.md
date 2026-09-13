---
status: done
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

## Verified Outcome

Both reported failures were stale, time-sensitive fixture proofs rather than
production behavior defects. Their fixed August timestamps had crossed the
dead-letter store's 30-day retention boundary against the host clock. The store
therefore omitted still-relevant fixture records from `list()`: partial dismissal
looked like an aggregate clear, and reconciliation could no longer recover the
changed item's run metadata, producing honest `contract/unattributed` and trigger
fallback labels. Freezing only `Date` at the fixture's declared `NOW` keeps the
records inside their production retention policy while leaving asynchronous
timers real.

The focused proof now asserts persisted issue state after partial dismissal,
one aggregate clear after final dismissal, and the explicit unattributed result
when run metadata is genuinely absent. The production-capture replay and restart
journeys exercise the real store, projector, runtime, task writer and persisted
reconciliation state; only host port allocation and process-table inspection are
controlled because those OS facilities are unavailable in the managed test
environment. The replay's resolved-state oracle also retains the terminal task
link, matching the projector's provenance contract.

Verification-LOC measurement with `scripts/count-verification-loc.py`:

- Executable test: 266,525 → 266,656 (`+131` LOC; 1,271 files unchanged).
- Authored test support: 21,075 → 21,075 (`0` LOC).
- Generated/vendored exclusions: 15,799 → 15,799 (`0` LOC).
- Production: `0` LOC changed.

Behavioral proof:

- `pnpm test:owner src/modules/autonomy/autonomy-issue-runtime-sources.test.ts`
  passes all 4 focused source/projector cases.
- `pnpm test:integration src/modules/autonomy/production-dead-letter-routing-replay.integration.test.ts`
  passes the captured open, revision, generated-task and aggregate-clear journey.
- `pnpm test:integration src/modules/autonomy/autonomy-issue-reconciliation.integration.test.ts`
  passes all 3 cancellation, dead-letter replay and restart reconciliation journeys.
