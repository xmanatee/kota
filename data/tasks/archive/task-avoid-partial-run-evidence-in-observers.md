---
status: done
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


## Implementation and verification

Completed in builder run `2026-09-12T14-17-52-792Z-builder-u0od0k`.
Completed-outcome readers now use the shared evidence owner to snapshot artifact
candidates and durable run/publication dispositions before reading metadata.
Starting, retained and undelivered-publication runs are excluded; decoded
terminal status and completion time remain required. Historical evidence stays
available after durable rows expire. Calibration, systemic outcomes, reviewer
results and eval terminal-result collection share this policy. Full inspection,
retention and recovery retain strict authority checks. Startup/publication
ordering was reviewed; no artifacts, recovery authority or scheduling mechanisms
were changed.

The owning interleaving/selection scenario and existing metadata, repair,
creation, calibration and coverage suites passed 110 tests. The ordinary
calibration event/runtime/worker replay passed without a dead letter. A direct
three-consumer probe retained one settled result during both missing startup
metadata and finished execution awaiting durable completion. Existing publication
recovery, DLQ supersession and observer workflow checks passed. The broader run
passed 18 tests and failed 10 subprocess cases at the sandbox process-inspection
or spawn boundary, including `/bin/ps EPERM`; those checks are not claimed as
passing. `pnpm check:fast` and production TypeScript compilation into a run-owned
output directory passed. Evidence and limitations are recorded in this run's
`summary.md`, `owner-final.log`, `observer-probe.json`,
`calibration-replay-final.log`, `recovery-consumers.log`,
`check-fast-final.log` and `build-validation.log`.

## Operational follow-up after publication

The original production calibration run
`2026-09-12T10-38-39-249Z-evaluator-calibration-monitor-jv28xr` still needs normal
retry/redrive after this change is published and deployed. Verify its ordinary
observation and reconcile its DLQ item through the supported mechanism, retaining
the incident evidence. The isolated replay is not that production retry.
This follow-up belongs after runtime-owned publication and does not block the
completed implementation step; no production retry or DLQ disposition is claimed.
