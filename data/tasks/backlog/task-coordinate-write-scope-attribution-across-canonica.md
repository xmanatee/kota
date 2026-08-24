---
id: task-coordinate-write-scope-attribution-across-canonica
title: Coordinate write-scope attribution across canonical workspace writers
status: backlog
priority: p1
area: autonomy
summary: Extend canonical workspace coordination beyond the in-process agent-run limiter so security-review and other scoped agents cannot be blamed for mutations made concurrently by another KOTA or native-CLI writer. Preserve fail-closed detection for genuine out-of-scope agent edits, then resolve the cited dead letter and restore the interrupted security review.
created_at: 2026-08-24T02:32:46.069Z
updated_at: 2026-08-24T03:03:39.437Z
task_class: Meta
depends_on: [task-protect-workflow-authority-provenance-from-agent-w]
---
## Problem

Security review and other scoped agents can be blamed for mutations made by a
concurrent KOTA or native-CLI workspace writer because write ownership is not
carried through one canonical authority boundary.

## Desired Outcome

One canonical workspace-writer coordination boundary serializes or attributes
mutations across workflow and native writers. Scoped enforcement evaluates
only agent-owned changes while genuine out-of-scope agent writes still fail
closed with inspectable provenance.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## Done When

- The issue's root cause is fixed or disproven with inspectable evidence.
- A typed clear observation or explicit disposition resolves the durable issue.

## Source / Intent

Issue reviewer disposition:     Dead letter dlq-43a218be-9e20-402b-a2a2-979ec0aa7bc6 shows security-review run 2026-08-24T02-15-26-595Z-security-review-v2dp75 falsely attributed concurrent task-planning changes to the read-only investigate-candidates agent. Its mutation baseline already contained 13 cited paths, the remaining paths match the later 54d03b1cf planning commit, and the agent's only visible write was its run-directory commit message. This recurs after two completed false-attribution repairs, so it warrants concrete work rather than observation or resolution.


Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-43a218be-9e20-402b-a2a2-979ec0aa7bc6

## Product / Safety Link

This issue repair protects Product and Safety throughput by removing a durable autonomy failure or review gap before it consumes builder capacity.

## Initiative

One autonomy issue, one decision, one implementation path.

## Acceptance Evidence

-     A regression fixture reproduces the cited run shape with pre-existing dirty task paths and a separate canonical writer changing or staging those paths during investigate-candidates. The scoped reviewer waits for exclusive ownership or records the changes as externally owned, completes without a false write-scope violation, and does not revert the other writer's work. A companion test proves a genuine reviewer-authored out-of-scope mutation still fails with a violation artifact. Preserve a run artifact documenting redrive or dismissal of dlq-43a218be-9e20-402b-a2a2-979ec0aa7bc6 and a successful replacement security review for the interrupted high-risk change set.

## Generated Work Provenance

Proposal key: `autonomy-issue:autonomy-issue-b814699e74ca9d6922a2`

- Source: improver; run: 2026-08-24T02-28-30-158Z-improver-xraffz
  - Issue: autonomy-issue-b814699e74ca9d6922a2; revision: 1
  - Evidence: .kota/dead-letter-queue/items.json#dlq-43a218be-9e20-402b-a2a2-979ec0aa7bc6

<!-- generated-work-proposal: {"key":"autonomy-issue:autonomy-issue-b814699e74ca9d6922a2","provenance":[{"source":"improver","runId":"2026-08-24T02-28-30-158Z-improver-xraffz","issueKey":"autonomy-issue-b814699e74ca9d6922a2","semanticRevision":1,"evidenceRefs":[".kota/dead-letter-queue/items.json#dlq-43a218be-9e20-402b-a2a2-979ec0aa7bc6"]}]} -->
