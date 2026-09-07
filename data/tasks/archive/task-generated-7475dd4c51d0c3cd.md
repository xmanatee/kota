---
status: done
---
# Resolve blocking-worker source loader from the KOTA installation

## Problem

Repair source-mode worker bootstrap in src/core/workflow/blocking-operation.ts so tsx resolves from the owning KOTA installation independently of process working directory. Use the eleven cited improver failures as provenance, distinguishing their recorded resolution failure from the independently reproduced external-directory trigger. Preserve worker isolation, error propagation, cancellation, progress reporting, and compiled execution. Keep operational replay and dead-letter disposition runtime-owned.

## Desired Outcome

Resolve autonomy issue autonomy-issue-1116d49526fe921f4801 at semantic revision 5.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## How We Will Know

Exercise runWorkflowBlockingOperation in source mode from an external directory without tsx installed there, using the loader available in the KOTA installation. The scenario reproduces the current Cannot find package 'tsx' failure before the repair and returns the operation result afterward. Verify normal repository-directory and compiled execution remain functional, with existing worker error, cancellation, and progress checks passing.

## Context

Issue reviewer disposition:     Canonical SQLite records confirm all eleven linked improver runs, including 2026-09-07T17-39-39-190Z-improver-t0ahzj and 2026-09-07T17-39-39-758Z-improver-xqhcb5, failed because inspectImproverWorktreeInWorker could not resolve tsx from [worker eval]. Issue summaries are empty; linked metadata and dead-letter files were inaccessible. Current blocking-operation.ts still imports tsx/esm/api through an eval worker. A read-only production-boundary probe succeeded from the repository directory and reproduced the same resolution error from an external directory. Later successful runs therefore do not eliminate the demonstrated dependency-resolution defect. Canonical issue state has no task or question owner, and active tasks and inbox contain no matching repair.


Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-103edc77-3d67-4822-8853-dd531900fe0e
- dead-letter: .kota/dead-letter-queue/items.json#dlq-2033819e-0414-402d-b491-268ecd61d2c5
- dead-letter: .kota/dead-letter-queue/items.json#dlq-6aa3074c-3648-456c-9af7-1734d213d039
- dead-letter: .kota/dead-letter-queue/items.json#dlq-6deabe76-b23c-4779-b4af-2cae332c095e
- dead-letter: .kota/dead-letter-queue/items.json#dlq-7781d80e-938b-43da-896c-b4ae535f780a
- dead-letter: .kota/dead-letter-queue/items.json#dlq-8314dfec-89bf-4cfb-94d7-3cc7b0cc0e24
- dead-letter: .kota/dead-letter-queue/items.json#dlq-a24504ad-30d2-4178-a26f-b3db06a0e74c
- dead-letter: .kota/dead-letter-queue/items.json#dlq-ad69b9a1-7e46-460c-96c3-7b48c75f358e
- dead-letter: .kota/dead-letter-queue/items.json#dlq-cc847471-6faf-46d0-adf6-b66fdf93e651
- dead-letter: .kota/dead-letter-queue/items.json#dlq-e7ef3900-1d5a-4a7d-8d78-2dfeb0159016
- dead-letter: .kota/dead-letter-queue/items.json#dlq-f2b79f07-c567-4246-aad1-a62a7c887678
- run: .kota/runs/2026-09-07T17-39-39-190Z-improver-t0ahzj/metadata.json
- run: .kota/runs/2026-09-07T17-39-39-247Z-improver-lkuqgx/metadata.json
- run: .kota/runs/2026-09-07T17-39-39-304Z-improver-v16qqe/metadata.json
- run: .kota/runs/2026-09-07T17-39-39-361Z-improver-dlbjvt/metadata.json
- run: .kota/runs/2026-09-07T17-39-39-417Z-improver-vilk5a/metadata.json
- run: .kota/runs/2026-09-07T17-39-39-473Z-improver-4rdwg2/metadata.json
- run: .kota/runs/2026-09-07T17-39-39-529Z-improver-fs1vvk/metadata.json
- run: .kota/runs/2026-09-07T17-39-39-584Z-improver-t6zfks/metadata.json
- run: .kota/runs/2026-09-07T17-39-39-638Z-improver-uizxbe/metadata.json
- run: .kota/runs/2026-09-07T17-39-39-696Z-improver-dlstg4/metadata.json
- run: .kota/runs/2026-09-07T17-39-39-758Z-improver-xqhcb5/metadata.json
