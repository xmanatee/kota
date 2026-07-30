---
id: task-security-review-approval-transitions-read-and-then
title: Security review: Approval transitions read and then rewrite a project-writable approval pathname without rejecting symbolic links or opening the destination with no-follow semantics. A concurrent project writer can replace the verified record with a symlink between the read and write, causing the less-constrained daemon process to truncate and overwrite a host file when approving, rejecting, or expiring the record.
status: done
priority: p1
area: security
task_class: Safety
summary: Approval transitions read and then rewrite a project-writable approval pathname without rejecting symbolic links or opening the destination with no-follow semantics. A concurrent project writer can replace the verified record with a symlink between the read and write, causing the less-constrained daemon process to truncate and overwrite a host file when approving, rejecting, or expiring the record.
created_at: 2026-07-28T22:09:25.953Z
updated_at: 2026-07-29T05:40:22.762Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/approval-queue.ts
claim:

> Approval transitions read and then rewrite a project-writable approval pathname without rejecting symbolic links or opening the destination with no-follow semantics. A concurrent project writer can replace the verified record with a symlink between the read and write, causing the less-constrained daemon process to truncate and overwrite a host file when approving, rejecting, or expiring the record.

## Desired Outcome

> Require the approval directory and records to be real, daemon-owned directories and regular files. Perform record transitions with a no-follow file descriptor or a safely created temporary regular file plus atomic rename, and fail if the destination is a symlink or changes identity during the transition.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-28T21-49-54-397Z-security-review-declvj.

finding id: finding-approval-record-symlink-host-file-overwrite
candidate id: auth-approval-boundary:src/core/daemon/approval-queue.ts:1
verdict: confirmed
rationale:

> Approval records reside under the project-local .kota/approvals directory. ApprovalQueue.read uses readFileSync on the pathname and write uses writeFileSync on a newly resolved pathname without lstat, file-identity verification, O_NOFOLLOW, or an atomic regular-file replacement. A project writer can therefore substitute a record with a symlink after selection and before approveSelected, reject, or expireStale writes it, causing the daemon to follow and truncate the symlink target.

Evidence:

Evidence 1:



path: src/core/daemon/approval-queue.ts

line: 142

excerpt:



> private read(path: string): PendingApproval {
>   const item = JSON.parse(readFileSync(path, "utf-8")) as PendingApproval;

Evidence 2:



path: src/core/daemon/approval-queue.ts

line: 154

excerpt:



> private write(item: PendingApproval): PendingApproval {
>   const projected = projectApprovalForStorage(item);
>   writeFileSync(
>     approvalFilePathForItem(this.dir, projected),
>     JSON.stringify(projected, null, 2),
>   );

Evidence 3:



path: src/core/daemon/approval-queue.ts

line: 293

excerpt:



> const result = this.selectForExecution(descriptor.approvalId);
> ...
> const approved = this.approveSelected(
>   approval,
>   note,
>   resolutionSource,
>   executionInput,
> );

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node node_modules/vitest/vitest.mjs run src/core/daemon/approval-queue.test.ts src/core/daemon/approval-queue-mcp.test.ts src/core/daemon/approval-queue-singleton.test.ts src/core/daemon/approval-queue-expiration.test.ts src/core/daemon/approval-queue-execution-descriptor.test.ts src/core/daemon/approval-queue-events.test.ts src/core/daemon/approval-queue-filesystem-security.test.ts src/modules/approval-queue src/approval-expiry.integration.test.ts src/core/daemon/daemon-multi-project-isolation.test.ts src/core/tools/approval.test.ts src/core/workflow/owner-decision-step.test.ts --configLoader runner --silent=true --maxWorkers=1` — 20 files and 217 tests passed, including deterministic substitution immediately before descriptor mutation.
- `node node_modules/typescript/bin/tsc --noEmit` — passed.
- `node node_modules/@biomejs/biome/bin/biome check src/core/daemon/approval-queue.ts src/core/daemon/approval-queue-types.ts src/core/daemon/approval-record-repository.ts src/core/daemon/approval-execution-selection.ts src/core/daemon/approval-queue-item.ts src/core/daemon/approval-queue-expiration-policy.ts src/core/daemon/approval-record-storage.ts src/core/daemon/approval-record-storage-anchor-helper-source.ts src/core/daemon/approval-record-storage-helper-source.ts src/core/daemon/approval-queue-filesystem-security.test.ts` — passed.
