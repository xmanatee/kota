---
status: open
priority: p2
---

# Make blocked-task evidence review readable and proportional to changed inputs

## Observed Gap

On September 13, `2026-09-13T00-35-51-890Z-blocked-promoter-qfsp76`
reviewed five blocked tasks but promoted none. Its retained
`steps/review-blocked-evidence.json` reports that the X-source collection was
602,864 bytes with 57 candidate artifacts, while its review projection was
unavailable at the 128 KiB boundary. Other decisions could inspect queue
bookkeeping but not the relevant execution or capability evidence. This does
not establish that the original prerequisites cleared, nor that they remain
unavailable on the host: the review itself lacks readable selected outcomes.

Subsequent runs `qybhru`, `1ciawp`, `ro6ppo`, and `zwg0qd` returned empty
`reviews` arrays. Their review steps still took 98,334, 101,785, 107,903, and
100,004 ms respectively. Inspect/promote steps added about 26-28 seconds per
run. Full IDs and measurements remain in the September 13 runtime metadata.
These are observed workflow costs, not a claim that models ran in each step.

## Owning Mechanism

`blocked-promoter/evidence-review.ts` collects and projects each task's evidence
before comparing the durable fingerprint. It writes a whole collection and
asks the shared judge to read that file. Inspect that consumer together with
the existing scoped evidence handoff and `blocked-promoter/evidence.ts`.
Trace the actual collection, review projection and read authority; do not
assume the file mentioned in a prompt is readable by the isolated reviewer.

Reuse the selected-evidence handoff repaired in `1573e27e5` and the bounded
collector already owned by `task-bound-recovery-evidence-collection-to-relevant-work`.
Those completed repairs must remain intact. Do not add a second evidence store,
review protocol, scheduler, arbitrary parent-directory grant or unsafe raw read.

## Outcome

The blocked reviewer receives bounded, attributable relevant outcomes and
counterevidence, including collections larger than an individual projection
limit. Keep private originals under their existing retention owner and report
genuine missing, truncated or inaccessible evidence explicitly. A failed evidence
handoff is not a completed substantive precondition assessment. After repairing
the handoff, an unchanged old unavailable verdict must not suppress reassessment.

Reduce unchanged-input collection cost through the existing evidence and state
owners. First measure where the live time goes, including repeated task-history
reads; reuse a per-run selection or existing authoritative revisions where
appropriate. Preserve detection of changed evidence, task contracts, executable
probe inputs, capabilities and reviewer policy. Do not replace correctness with
a time-only cooldown or build a new caching subsystem without demonstrated need.

## Verification And Completion

Extend the existing blocked-review consumer scenario with a representative large
collection: relevant clearing and contradictory outcomes must actually reach the
isolated judge. Preserve scope isolation and fail-closed promotion for unmet
prerequisites. An unchanged follow-up must avoid another substantive review;
changed relevant evidence and a repaired previously unavailable handoff must be
reconsidered. Measure selected reads, elapsed collection time and helper count on
representative history before and after; do not test private call sequences or
duplicate every harness suite.

Publish the implementation and proportionate proof, not an audit-only report.
The monitor owns deployment and observing a subsequent real blocked review.
Do not mark the five existing tasks complete or lower their security requirements
merely to produce queue movement; reopen only when their actual prerequisites
clear, and continue independent implementation meanwhile.
