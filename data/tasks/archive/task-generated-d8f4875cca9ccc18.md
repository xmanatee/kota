---
status: done
---
# Preserve security-review blockers after provider policy refusals

## Problem



## Desired Outcome

When the provider refuses a defensive security review, operators see the concrete refusal and unmet prerequisite, and the affected review remains explicitly incomplete with its evidence preserved. Unchanged blocked work does not repeatedly enter automatic investigation merely because time passes. Recovery uses the existing runtime and review owners after relevant prerequisite evidence changes or an explicit authorized retry. Preserve provider safeguards and distinguish policy refusals from transient outages and local implementation failures.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## How We Will Know

Replay the cited refusal through the production failure and review-admission boundaries. Verify an inspectable blocked outcome retains run provenance and unknown coverage, survives restart, and does not automatically reinvestigate unchanged inputs after cooldown. Demonstrate authorized recovery preserves pending evidence and records coverage only after actual review. Confirm transient provider failures and genuine execution errors retain their appropriate recovery behavior. Include an operator-facing diagnostic or scoped runtime export; deterministic refusal handling alone must not be reported as a completed live security review.

## Context

Issue reviewer disposition:     issue-evidence.json attributes run 2026-09-10T02-03-16-653Z-security-review-zlzeed and dlq-01ad2e02-aaca-4d98-bf02-0ebeacbf5a0b to a provider cybersecurity refusal at investigate-candidates. Both observations share one failure timestamp; they do not prove independent recurrence. Scanning succeeded, but investigation did not complete. The shared step-executor-retry.ts classifier leaves this refusal unclassified, while security-review/finding-steps.ts records unavailable coverage only after successful structured investigation. Thus the existing unavailable-review admission protection cannot handle this failure. The active task-review-security-by-evidence-and-root-cause-family owns publication and live-cohort acceptance, not provider-refusal handling; the historical classifier-restoration task is archived. A distinct task should make this external blocker durable and actionable without bypassing provider safeguards.

Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-01ad2e02-aaca-4d98-bf02-0ebeacbf5a0b
- run: .kota/runs/2026-09-10T02-03-16-653Z-security-review-zlzeed/metadata.json

## Completion

The shared failure classifier now recognizes the cited provider policy refusal
without transient backoff. Security-review investigation and revalidation retain
an explicit blocked outcome, provider diagnostic and prerequisite, run provenance,
unknown coverage, pending findings, and evidence requests through the existing
runtime state/finalization owners. Admission suppresses unchanged unavailable
inputs, including stale dispatcher observations; a new explicit evidence request
can admit recovery without discarding pending evidence.

Builder run `2026-09-11T10-14-15-607Z-builder-342w2n` retains the scoped
`refusal-replay/` export and verification summary. The exact captured refusal was
replayed through production execution, persistence and admission; fresh runtimes
preserved the blocker, cooldown did not readmit it, and a controlled recovery
response recorded coverage only after review execution. Both refusing phases,
transient errors and execution errors are covered by focused tests. Static checks,
production build and 101 focused runtime/admission tests passed. The broader
security-review/classifier selection passed 109 of 110 tests; its existing
credential-terminology publication test could not launch task validation because
the sandbox denies `/bin/ps` (EPERM).

This completes refusal handling, not the live security review. The source run and
dead letter remain one incident with one failure timestamp. No provider safeguard
was bypassed, no live coverage was claimed, and the original incident and pending
live evidence were not modified.
