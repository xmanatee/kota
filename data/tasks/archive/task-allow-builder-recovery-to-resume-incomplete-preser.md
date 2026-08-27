---
status: dropped
---

# Allow builder recovery to resume incomplete preserved evidence

## Problem

Preserved-evidence lookup incorrectly applies completion-time validation before
a recovery continuation runs, so a valid interrupted lineage without its final
verification and commit artifacts fails before it can resume.

## Desired Outcome

Recovery distinguishes continuation eligibility from terminal completion
validation: it safely resumes valid incomplete evidence with the original
manifest and run lineage, then enforces every required completion artifact at
validation and commit time.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## Done When

- The issue's root cause is fixed or disproven with inspectable evidence.
- A typed clear observation or explicit disposition resolves the durable issue.

## Source / Intent

Issue reviewer disposition:     The cited builder run `.kota/runs/2026-08-23T17-26-21-807Z-builder-8knpd4/metadata.json` claimed the preserved Apple-client worktree but failed in `prepare-worktree` with `Builder evidence filesystem operation failed (ENOENT)`. The original interrupted run still has its evidence lineage, but naturally lacks completion-only `success-criteria-verified.txt` and `commit-message.txt`. `findPreservedBuilderEvidenceRunId` incorrectly applies completion-time `inspectBuilderEvidence` before the resumed agent runs, making this recovery path unable to finish incomplete work. This is a local runtime defect blocking an active Product task, with no overlapping open task found.

Evidence:

- run: .kota/runs/2026-08-23T17-26-21-807Z-builder-8knpd4/metadata.json

## Product / Safety Link

This issue repair protects Product and Safety throughput by removing a durable autonomy failure or review gap before it consumes builder capacity.

## Initiative

One autonomy issue, one decision, one implementation path.

## Acceptance Evidence

-     A focused builder workflow fixture creates an interrupted preserved worktree containing a valid evidence directory and manifest but no `success-criteria-verified.txt` or `commit-message.txt`, then proves recovery progresses through `prepare-worktree` into `build` using the original evidence lineage. Negative fixtures prove missing or malformed manifests, escaped paths, and symbolic-link evidence still fail closed. Existing completion-time checks must continue rejecting missing required evidence. A runtime recovery projection for the cited Apple-client lineage shows the continuation no longer terminates with evidence-filesystem ENOENT and the preserved claim progresses to completion or a durable terminal disposition.

## Follow-up Disposition

The code and fail-closed behavior are covered by focused fixtures. The leased
builder worktree cannot read the canonical parent runtime store, so live
verification of the cited claim remains explicitly tracked by
`task-verify-the-cited-apple-builder-recovery-lineage`; the candidate fixture is
not presented as a production disposition.

- Source: improver; run: 2026-08-23T17-28-18-504Z-improver-qeluab
  - Issue: autonomy-issue-4bb0f021759db9660e18; revision: 1
  - Evidence: .kota/runs/2026-08-23T17-26-21-807Z-builder-8knpd4/metadata.json

## Disposition

Dropped because the builder-specific preserved-worktree and evidence-reuse
continuation path was removed. Shared run lifecycle recovery now owns sandbox
adoption and terminal attention without this workflow-specific lookup.
