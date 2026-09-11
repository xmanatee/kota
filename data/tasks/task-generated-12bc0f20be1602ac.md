---
status: blocked
priority: p0
---
# Restore dispatcher routing when retained security evidence fails validation

## Problem

Dispatcher cannot route any task because the diagnostic projection of one
confirmed security finding was persisted as authoritative review state. Five
dispatcher runs failed between 07:53 and 09:16 UTC on September 11; both agent
slots were consequently idle even though independent repair work was available.

The operational monitor reproduced the producer defect at `2359c5a31`:

- Review run `2026-09-11T04-24-51-248Z-security-review-t7qlj3` wrote valid
  `security-review-investigation.json` and `security-review-revalidation.json`.
  Finding id `standalone-instance-lock-credential-disclosure` and invariant
  `runtime-credentials-must-not-enter-agent-context` pass the domain decoder.
- `projectWorkflowStepResultForStorage` calls evidence redaction. Its
  secret-like-word heuristic turns both harmless identifiers into `[redacted]`.
  The persisted `record-investigation-findings` and `record-revalidation` step
  outputs therefore differ from the validated domain artifacts.
- `finalizeSecurityReview` consumes those projected outputs through shallow
  `expectStructuredOutput` checks and stores them in
  `autonomy.security-review.evidence`. Canonical scope `8nrg1m`, revision 9,
  pending entry 2 contains the corrupted invariant and original run provenance.
- The next `decodeSecurityReviewState` correctly rejects that invariant, but
  dispatcher calls it before routing unrelated tasks. Diagnostic redaction has
  therefore corrupted a domain contract and stopped ordinary admission.

This is not an invalid model response and not a reason to relax security schemas.
The original validated artifacts still exist; reconstruct only from attributable
evidence, never guess the lost identifier or erase the failed publication.
## Desired Outcome

Ordinary eligible work can dispatch when a retained security finding fails validation. The security-review state owner preserves the invalid entry and its provenance with an inspectable recovery disposition, prevents invalid findings from authorizing publication, and supports safe reconciliation through existing runtime ownership. Diagnose the persistence or compatibility boundary responsible and prevent recurrence without silently discarding evidence, inventing invariant identity, or weakening finding validation. Coordinate with the existing security-family task without duplicating its publication and cohort work.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.
- Keep diagnostic projections separate from durable control inputs. Reuse the
  existing integrity-checked run-artifact/reference and atomic state publication
  owners, rather than adding a parallel result store or special redaction bypass.
  Audit the touched security investigation, revalidation, retry and finalization
  consumers together; validate the authoritative shape at its publication boundary.
- Recover the actual retained entry through the owning state/recovery mechanism,
  preserving its previous projection and source run for diagnosis. If provenance
  cannot be established, park it visibly so it cannot authorize a task mutation;
  malformed security evidence must not prevent unrelated work from dispatching.
- Do not disable secret scrubbing globally, whitelist arbitrary identity fields,
  turn `[redacted]` into a nominal invariant, silently drop findings, or redrive the
  completed security investigation merely to manufacture a new result.
- Use focused public-boundary regressions: valid findings containing credential
  terminology survive domain persistence/finalization, diagnostic exports remain
  redacted, and malformed retained evidence stays visible without blocking task
  routing. Do not build another workflow engine or broad migration framework.

## How We Will Know

Exercise the production persisted-state and runtime.idle boundaries with the cited pending finding validation failure. Show eligible task routing continues, invalid evidence remains visible and cannot publish, and valid security evidence retains its normal behavior. Verify the disposition survives restart and owner-mediated reconciliation preserves provenance and task ownership. Include an attributable scoped dispatcher export demonstrating recovery from this failure; distinguish representative reproduction from recovery of the actual retained entry.

## Context

Issue reviewer disposition:     The scoped issue-evidence.json records three distinct dispatcher failures between 07:53 and 08:44 UTC; two run records repeat the dead-letter observations. All reject pending[2].finding.violatedInvariant against the lowercase token pattern. Dispatcher decodes the entire security-review state before routing, so this retained entry prevents ordinary dispatch. Current review-state.ts reproduces that failure path; the export does not establish how the invalid value entered persistence. task-review-security-by-evidence-and-root-cause-family owns valid pending-evidence publication and live-cohort acceptance, but does not cover this state-decoding failure that blocks all routing. No active task explicitly owns it. This requires builder-owned source repair, not doctor.fix.

Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-00fd9288-826d-441f-84b2-05dec8fdb6f9
- dead-letter: .kota/dead-letter-queue/items.json#dlq-36536ce4-c6d9-4ead-af27-46a5ac49ddc6
- dead-letter: .kota/dead-letter-queue/items.json#dlq-a3adccf0-be89-4fe8-bda4-e33179b1fc1e
- run: .kota/runs/2026-09-11T07-53-45-796Z-dispatcher-8240rg/metadata.json
- run: .kota/runs/2026-09-11T08-14-13-780Z-dispatcher-tl4eej/metadata.json

## Implementation and verification (2026-09-11)

The retained builder changes now separate investigation, revalidation and
publication receipts from redacted diagnostic step outputs. Their consumers
reload schema-validated, integrity-checked run artifacts, and atomic state
publication validates the complete security-review domain shape.

The state owner migrates invalid pending entries into an inspectable recovery
disposition retaining the complete original projection and source run. Dispatcher
continues ordinary routing and collects recovery through the shared worker.
Reconciliation requires the successful source run in the selected scope, matching
complete legacy step projections, consistent investigation/revalidation, and
unchanged artifact hashes at finalization. Unavailable or mismatched evidence
stays parked and cannot authorize task publication. Recovered evidence returns to
the existing publication/resource owner; no retained builder contract is edited.

The focused regressions establish credential-word identity preservation, redacted
diagnostics, malformed-entry parking and routing across restarted runtime
sessions, scoped provenance checks, artifact-change rejection, and atomic rollback
of review consumption. The existing security-family task remains the owner of
publication/cohort acceptance; this task does not duplicate that work.

Run evidence is under
`.kota/runtime/2026-09-11t09-43-00-380z-builder-300f747831b0954b014321d3b1bb904a43d49389335ab70f68967d7d69ed915e/agent/`.
`dispatcher-reproduction.json` replays the exact corrupted finding projection
from the supplied scope `8nrg1m` export through production SQLite and two
`runtime.idle` sessions. Both route independent work, retain the original
projection and emit no security publication. This is an attributable local
reproduction, not recovery of canonical pending entry 2. `source-artifact-access.json`
records denied reads of the cited canonical metadata, investigation and
revalidation artifacts. The supplied export contains diagnostic projections;
it cannot reconstruct the lost identifiers authoritatively.

## Blocked on

```
kind: operator-capture
path: .kota/runs
description: Host-owned activation and security-state reconciliation of the retained scope 8nrg1m entry, followed by an attributable scoped dispatcher/recovery export; use existing authorized runtime/evidence owners or equivalent exports.
```

After runtime-owned integration/activation, the next ordinary dispatcher run can
park the actual invalid entry and reconcile it if its successful source run and
original artifacts verify. Acceptance still requires its persisted disposition,
continued eligible routing and task-resource preservation in the actual scope,
plus the supervised publication proof that this sandbox cannot execute because
its process-identity probe receives `spawnSync /bin/ps EPERM`. No canonical state,
daemon process or other retained writer was changed. Sandbox denial does not
establish that the host lacks these capabilities; equivalent attributable scoped
evidence can satisfy the remaining acceptance without a new investigation or
renewed authorization.
