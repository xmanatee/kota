---
id: task-allow-builder-recovery-to-resume-incomplete-preser
title: Allow builder recovery to resume incomplete preserved evidence
status: ready
priority: p1
area: autonomy
summary: Separate preserved-evidence continuation eligibility from completion-time evidence validation. A recovery continuation must safely reuse the original evidence directory and manifest before all required completion artifacts exist, while retaining strict screening and required-file enforcement at validation and commit time. Replace the mocked recovery happy path with a production-shaped fixture that exercises the real preserved-evidence lookup.
created_at: 2026-08-23T20:50:51.521Z
updated_at: 2026-08-24T03:03:20.000Z
task_class: Meta
---
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

## Generated Work Provenance

Proposal key: `autonomy-issue:autonomy-issue-4bb0f021759db9660e18`

- Source: improver; run: 2026-08-23T17-28-18-504Z-improver-qeluab
  - Issue: autonomy-issue-4bb0f021759db9660e18; revision: 1
  - Evidence: .kota/runs/2026-08-23T17-26-21-807Z-builder-8knpd4/metadata.json

<!-- generated-work-proposal: {"key":"autonomy-issue:autonomy-issue-4bb0f021759db9660e18","provenance":[{"source":"improver","runId":"2026-08-23T17-28-18-504Z-improver-qeluab","issueKey":"autonomy-issue-4bb0f021759db9660e18","semanticRevision":1,"evidenceRefs":[".kota/runs/2026-08-23T17-26-21-807Z-builder-8knpd4/metadata.json"]}]} -->
