---
status: open
priority: p1
---

# Collect unreachable runtime state and compact retained evidence

## Problem

Runtime cleanup is split across run-artifact pruning, sandbox reconciliation, session sweeping, task retention, and evidence policies. Several stores expire data only when queried or cap projections without physically reclaiming their backing records. As a result, non-recoverable worktrees, KOTA-owned branches, sessions, run records, event and dead-letter payloads, owner records, database rows, and temporary files can remain indefinitely and pollute a scope. Cleanup must distinguish genuinely unreachable state from ambiguous work that might still be recoverable.

## Desired Outcome

Give the daemon one lifecycle collector that derives reachability from the authoritative runtime stores and reclaims state proven to be non-recoverable. The collector classifies each candidate as keep, compact, delete, or needs_attention with a stable reason; performs physical compaction where retention currently affects only reads; and exposes dry-run plus completed-sweep evidence including reclaimed bytes.

## Constraints

- Use the existing RunStateDatabase, RunCoordinator, run lifecycle, integration queue, sandbox manager, and evidence policy as authorities; do not create a second lifecycle or retention truth.
- Reachability comes before age. Time limits may provide grace periods but must never be the sole proof that work is non-recoverable.
- Never automatically delete dirty, unintegrated, unverifiable, active, waiting, integrating, needs_attention, explicitly pinned, approval-blocked, redrivable, or recovery-critical state. Preserve ambiguous candidates and project an actionable reason.
- Limit cleanup to the registered scope, its KOTA state root, and refs or worktrees positively identified as KOTA-owned. Verify repository identity and Git common-directory ownership before Git cleanup.
- Keep sweeps bounded, idempotent, atomic or restartable, and safe under concurrent terminal transitions and daemon restarts. Preserve replay, idempotency, audit, foreign-key, and minimum-evidence invariants.
- Malformed historical records must be quarantined or reported without preventing unrelated safe reclamation.

## How We Will Know

- Startup recovery, terminal run transitions, and a bounded periodic trigger all invoke the same collector.
- A dry-run and status projection enumerate candidate, decision, reason, age, owner, and estimated bytes; completed sweeps report actual reclaimed counts and bytes by store.
- Clean integrated sandboxes, orphaned non-repository sandboxes, associated KOTA run branches, stale process identity, expired sessions and bindings, terminal owner records, idempotency records, and temporary payloads are removed only after their reachability roots disappear.
- Run artifacts, the event journal, dead-letter snapshots, and terminal SQLite rows are physically compacted while retaining the evidence and references required for recovery and operator inspection. Database reclamation is transactional and proportionate.
- Dirty or unintegrated worktrees and any candidate with conflicting ownership survive the sweep and appear as needs_attention with a concrete remediation path.
- Tests cover multi-scope isolation, concurrent mutation, malformed records, interrupted compaction and restart, replay preservation, Git ownership checks, and repeated no-op sweeps. A fixture proves retained state remains usable and unreachable state is physically gone.

## Context

Operator request on 2026-08-27: keep the system clean by clearing things that are no longer recoverable, without silently discarding useful work. Current inspection found substantial retained run, event, and runtime state and fragmented cleanup ownership; these measurements are diagnostic context, not retention thresholds.
