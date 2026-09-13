---
status: done
---

# Restore authorized tool checkpoint and credential-overlay consumer proofs

## Evidence And Scope

At published `eb41e8e7c8b0509e8e33cc074f6baa0e950ba4eb`, focused reruns fail
these existing consumer journeys:

- `src/modules/openai-tools-agent-harness/adapter-session-resume.test.ts`:
  the supposed successful echo checkpoint instead persists “Tool declaration
  changed or is unavailable before authorization.” The next case never calls
  its tool executor, so it does not prove checkpoint-before-continuation.
- `src/modules/secrets/index.test.ts`: the approved originating-session overlay
  journey stops at “get_secret approval preflight failed”, before execution.

The shared declaration/authorization owner is under `src/core/tools/`; the
first rejection is in `tool-runner-execute-block.ts`. These observations establish
unmet positive proofs, not permission to bypass current declaration leases,
restore stale tools, or assume a sandbox cause. No active task owns these cases.

Own these two consumer suites and direct fixtures, consulting shared tool
registration and approval preflight. Correct production only if a defect is
shown at that owner. Keep changes bounded to the actual authorization contract;
do not rewrite harness session storage, all adapter suites or secret storage.

## Outcome And Acceptance

Observe successful authorized tool execution, durable result checkpoint before
continuation, and neutral transcript replay. Preserve rejection when a declaration
changes or disappears. For approved secret access, observe only the originating
live session overlay receiving the credential; stale/cross-session approvals must
fail and process-wide environment state must remain unchanged.

Expose the actual preflight rejection during diagnosis. Distinguish outdated
fixture registrations from runtime regressions. Use production registration,
lease and approval owners; external provider/executor ports may be controlled.
No live credential or model call is required for these deterministic contracts.
Run the affected suites and selected shared authorization/approval checks.

## Provenance And Measurement

Audit run `2026-09-12T22-32-50-597Z-builder-67j7si` retains
`assertion-triage.log` and `triage-more-results.json`. Apply the rules in
`task-assess-fifty-percent-reduction-after-citation-and-reminder-followups`.
Report category deltas independently; do not weaken safety or disable negative
checks to achieve a reduction. Local completion is restored attributable proof,
not a percentage or an assertion that the global target is feasible.
