---
id: task-reconcile-stale-recovery-state-blocking-existing-p
title: Reconcile stale recovery state blocking existing P1 repairs
status: done
priority: p1
area: autonomy
task_class: Meta
summary: Use the canonical workflow state-recovery path to release or supersede the stale builder claims for the existing builder-failure and defensive-security-review tasks, then disposition the open improver dead letter without duplicating either underlying repair.
created_at: 2026-07-25T14:44:27.087Z
updated_at: 2026-07-25T23:27:42.789Z
---

## Problem

    Use the canonical workflow state-recovery path to release or supersede the stale builder claims for the existing builder-failure and defensive-security-review tasks, then disposition the open improver dead letter without duplicating either underlying repair.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-25T14-40-42-734Z-progress-reviewer-n08ebz.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-25T14-40-42-734Z-progress-reviewer-n08ebz.

review verdict: needs-steering
review summary:

    Two builders delivered verified Safety and Meta outcomes, but recovery state is obstructing the next P1 repairs. The 20-task window is 7 Safety, 2 Platform, 9 Meta, 2 Unclassified, and 0 Product; no operator-journey risks were reported.

Evidence ids:

- run:2026-07-25T13-47-32-416Z-builder-bvup3r
- task:task-repair-workflow-failure-pattern-e178cde33f3a
- task:task-restore-defensive-security-review-after-classifier
- dead-letter:dlq-d042a107-c7ee-4d7b-946d-458124f2befd
- dead-letter:dlq-69c2533c-359d-47ba-91d3-74a3c45e4b1f

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A run artifact records canonical state-recovery before and after state; neither existing P1 task retains a stale active claim; each task is claimable, actively progressing, or explicitly superseded with rationale; the improver dead letter is redriven to a terminal outcome or dismissed with durable rationale; the security-review dead letter remains linked to its existing repair task or reaches a terminal disposition; task validation passes and no duplicate repair task is created.

- Builder run `2026-07-25T15-52-06-334Z-builder-e7it1w` records the current
  canonical before/after recovery projection, disposition evidence, mutation
  failure, and validation under
  `.kota/runs/2026-07-25T15-52-06-334Z-builder-e7it1w/`.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-07-25T15-52-06-334Z-builder-e7it1w/trusted-host-recovery-complete.json
description: trusted-host recovery evidence — from the canonical checkout, clear the interrupted merge and explicitly supersede builder-failure commit 467c730c2 with landed commit 0eb76a9f through workflow state-recovery; inspect the preserved security-review work against landed commit 18a12e397 and then merge it or explicitly supersede it without discarding unique changes; dismiss improver dead letter dlq-69c2533c-359d-47ba-91d3-74a3c45e4b1f with the recorded rationale; capture the resulting claim and dead-letter projection
```

## Status (2026-07-25 builder)

The current canonical projection and disposition analysis are complete, but
the required mutation cannot run from this linked builder sandbox. The daemon
control API is offline, canonical `.kota/` and linked Git metadata are outside
the writable workspace, and the attempted improver dead-letter dismissal was
rejected at the atomic write boundary without changing state.

The builder-failure branch outcome is superseded by `0eb76a9f`; the
security-review changes are covered by `18a12e397` but remain preserved for an
explicit trusted-host comparison; and 13 improver runs succeeded after the
cited provider failure. The owned task remains blocked until the typed
trusted-host artifact proves the canonical recovery actions actually ran.
