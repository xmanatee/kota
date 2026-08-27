---
status: done
---

# Reconcile the current progress-reviewer timeout dead letter

## Problem

    Preserve diagnostics for dlq-817c4292-86d0-416b-818f-22493c55a8c7, reproduce or replay its five-event workflow.completed batch, and determine whether the timeout is current or transient. Redrive the batch when still meaningful or dismiss it with durable rationale; harden the review path only if same-shape verification reproduces the failure.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-27T03-51-15-670Z-progress-reviewer-7qipnc.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-27T03-51-15-670Z-progress-reviewer-7qipnc.

review verdict: needs-steering
review summary:

    The window is Safety-heavy—Safety 7, Platform 1, Meta 1, Product 0—and shows three completed build outcomes. Work remains unblocked, but the multi-project secrets fix still awaits an already-pending merge decision, and one progress-reviewer batch exhausted its timeout retries and remains in the dead-letter queue.

Evidence ids:

- dead-letter:dlq-817c4292-86d0-416b-818f-22493c55a8c7
- run:2026-07-27T03-25-55-661Z-progress-reviewer-lk8i7q
- artifact:2026-07-27T03-25-55-661Z-progress-reviewer-lk8i7q:error.txt

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A run artifact records the diagnosis and before/after DLQ state; a same-shape five-event workflow.completed progress-review batch produces schema-valid review-evidence within 1,800,000 ms; the cited dead letter is redriven successfully or dismissed with durable rationale; and the final DLQ check reports no open item for this failure.
- Builder run
  `.kota/runs/2026-07-28T03-10-35-681Z-builder-7cx6ss/dead-letter-reconciliation.json`
  preserves both timeout records, their historical open evidence, terminal
  dismissal timestamps and rationales, and a final canonical-store check with
  zero open progress-reviewer or matching review-evidence timeout items.
- Builder run
  `.kota/runs/2026-07-28T03-10-35-681Z-builder-7cx6ss/same-shape-progress-review.json`
  compares the cited failed five-event batch with current same-shape runs.
  Run `2026-07-28T03-08-52-669Z-progress-reviewer-tnvcvr` completed five
  `workflow.completed` inputs with schema-valid `review-evidence` in 60,195 ms
  active runtime; run
  `2026-07-28T02-40-21-944Z-progress-reviewer-l4vmn6` independently did so in
  87,503 ms.
- The original cited item
  `dlq-817c4292-86d0-416b-818f-22493c55a8c7` is canonically `dismissed` with
  rationale `Superseded by successful run
  2026-07-27T03-51-15-670Z-progress-reviewer-7qipnc`. The current same-class
  item `dlq-b59f9da1-d0da-4dbe-bb82-091613e66639` is canonically `dismissed`
  with rationale `Superseded by successful run
  2026-07-28T00-00-00-017Z-progress-reviewer-yy2pfl`.

## Current Evidence

- The current same-class item is
  `dlq-b59f9da1-d0da-4dbe-bb82-091613e66639`, from run
  `2026-07-27T12-00-00-003Z-progress-reviewer-lv3ktz`.
- `review-evidence` consumed 1,800,001 ms of active runtime and 13,054,946 ms
  of host suspension before the active timeout fired. The suspension-aware
  timer behaved correctly; the unresolved question is why the agent did not
  finish during the full active window.
- A later progress-reviewer batch reached the provider after 469,069 ms active
  runtime and then failed on DNS resolution. That environmental failure does
  not prove the timeout fixed and must not be used to close this task.

## Resolution (2026-07-28 builder)

The active-runtime timeout is explicitly disproven as a current reproducible
five-event batch defect. The same workflow and Codex harness completed two
current five-event `workflow.completed` batches with schema-valid output using
less than five percent of the 1,800,000 ms active budget. The failed rail also
recorded the expected active duration, so host suspension was not charged as
active work. No workflow hardening is justified without a same-shape
reproduction.

Both relevant dead letters already have durable terminal dismissals. Redrive
would now replay stale evidence windows after successful reviews, so this run
preserves the existing dispositions instead of mutating terminal items. The
later DNS/provider failure remains excluded from the proof.
