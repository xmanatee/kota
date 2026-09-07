---
status: open
priority: p2
---
# Prevent overlapping attention-digest runs from failing on counter contention

## Problem

Inspect the cited dead letter through permitted evidence surfaces and correlate it with canonical attention-digest failures, including 2026-08-29T04-27-00-704Z-attention-digest-573vc9 and 2026-09-03T16-00-35-046Z-attention-digest-aj67r8. Repair shared-counter coordination using runtime-owned logical resources or the appropriate shared runtime mechanism so overlapping eligible triggers complete without pending-mutation failures. Preserve transactional counter updates and digest publication on successful runs; do not introduce workflow-owned locks or weaken compare-and-set rejection.

## Desired Outcome

Resolve autonomy issue autonomy-issue-7f2414f86864497af97d at semantic revision 1.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## How We Will Know

A focused scenario admits overlapping monitored workflow.completed triggers in one scope while a digest counter mutation is pending. Both digest runs complete, each contributes exactly one committed increment, and crossing the cadence boundary produces exactly one expected digest publication without a contention failure or dead letter. Confirm coordination remains scoped and record whether the original dead letter matches the reproduced failure.

## Context

Issue reviewer disposition:     Canonical issue state confirms one observation, empty summaries, and no owner for dlq-b223ec22-14cb-448e-8d13-5ab19c4b40f0. Its file is inaccessible, so direct linkage remains unverified. However, canonical runs independently establish four attention-digest failures from August 28 through September 3 caused by pending mutations of attention-digest/counter, including 2026-08-29T04-27-00-704Z-attention-digest-573vc9 immediately before this observation. Current workflow.ts stages that shared counter without declaring a logical resource. Later successful runs and delivered digests demonstrate operation, but do not disprove the overlap failure. Active tasks and inbox contain no matching repair owner. This repeated, actionable contention warrants one task.


Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-b223ec22-14cb-448e-8d13-5ab19c4b40f0
