---
status: open
priority: p2
---
# Keep completed-outcome observers independent of starting run artifacts

## Problem

Calibration run `2026-09-12T10-38-39-249Z-evaluator-calibration-monitor-jv28xr`
failed at 11:12:50 UTC on September 12 because the newly starting child
`scope-improvement-actions-child-c384de7f83a83389cdf97a33` did not yet have
metadata.json. That child completed normally at 11:12:56 and its metadata is valid.
No missing-result repair or owner input was actually required.

The calibration aggregator enumerates all run metadata before selecting its own
completed outcomes. The shared enumerator requires metadata for every durably
active run, while run creation publishes workflow/trigger/metadata files separately.
This makes an unrelated startup window fail a completed-outcome observation.

## Outcome

Use the existing durable run-state and evidence owners to give outcome readers a
coherent selection of relevant completed records. Review other consumers of that
same enumeration and the publication ordering before choosing the smallest fix.
Do not add sleeps, blanket missing-file catches, per-workflow exceptions, a second
run store or a new observer scheduler. Recovery/publication must still detect real
missing or malformed authority; observation must not claim incomplete work succeeded.

## Acceptance

- Starting another run cannot fail calibration or another completed-outcome reader.
- A retained active/publication record with genuinely corrupt required authority
  still fails its owning recovery path visibly; no evidence is deleted or invented.
- One focused owning test covers the interleaving and completed-result selection;
  preserve existing malformed-authority coverage rather than copying it everywhere.
- Retry the original failed calibration after publication and verify the ordinary
  observer flow, then reconcile its DLQ through the normal mechanism.
