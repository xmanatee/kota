---
status: done
---

# Security review: Approval expiry and pending-snapshot authentication use separate record reads. A same-user project writer can present a forged future createdAt or extended timeout during the expiry read, then restore the daemon-authenticated pending snapshot for the selection read. This allows an already-stale approval and its old review receipt to transition to approved.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/approval-queue.ts
claim:

> Approval expiry and pending-snapshot authentication use separate record reads. A same-user project writer can present a forged future createdAt or extended timeout during the expiry read, then restore the daemon-authenticated pending snapshot for the selection read. This allows an already-stale approval and its old review receipt to transition to approved.

## Desired Outcome

> Authenticate one stored pending snapshot before evaluating its deadline, then derive either expiration or execution selection from that same snapshot and identity. Remove the separate expiry and selection reads for both single and bulk approval paths. Add a regression that alternates record contents between reads and proves a stale approval cannot be signed or executed.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-31T07-22-02-469Z-security-review-o2mdmn.

finding id: finding-approval-expiry-authentication-toctou
candidate id: auth-approval-boundary:src/core/daemon/approval-queue.ts:1
verdict: confirmed
rationale:

> ApprovalQueue evaluates expiry using an unauthenticated record read, then selectApprovalForExecution performs a second read and authenticates only that later snapshot. Approval file identity tracks only device and inode, while updates occur in place, so content changes between those reads are not excluded by the identity check. The recorded probe reproduced successful snapshot selection and approval after the deadline. Single and bulk approval paths both retain this split-read boundary.

Evidence:

Evidence 1:

path: src/core/daemon/approval-queue.ts

line: 216

excerpt:

> private selectForExecution(id: string) {
>   this.expireExecutionTargetIfStale(id);
>   return selectApprovalForExecution(
>     this.records,
>     this.executionInputs,
>     this.reviewContexts,
>     this.scopeId,
>     id,
>     this.resolutionAuthenticator,
>   );
> }

Evidence 2:

path: src/core/daemon/approval-queue.ts

line: 344

excerpt:

> private expireExecutionTargetIfStale(id: string): void {
>   const current = this.records.read(id);
>   if (
>     current === null
>     || current.item.status !== "pending"
>     || !this.isStale(current.item, Date.now(), this.defaultTtlMs)
>   ) {
>     return;
>   }
>   try {
>     this.expireStored(current);
>   } catch (error) {
>     if (!(error instanceof ApprovalResolutionIntegrityError)) throw error;
>   }
> }

Evidence 3:

path: src/core/daemon/approval-execution-selection.ts

line: 51

excerpt:

> const stored = records.read(id);
> if (!stored || stored.item.status !== "pending") return { ok: false, reason: "not_found" };
> ...
> approval = authenticator.authenticatePending(stored.item);

Evidence 4:

path: .kota/runs/2026-07-31T07-22-02-469Z-security-review-o2mdmn/investigate-candidates-expiry-race-probe.json

line: 1

excerpt:

> A controlled same-inode record alternation reproduced the race with snapshotOk=true, approvalOk=true, and persistedStatus="approved" after the configured deadline.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node node_modules/vitest/vitest.mjs run src/core/daemon/approval-queue-expiration.test.ts --configLoader runner --silent=true` — 21 tests passed, including all single/bulk and `createdAt`/`timeoutMs` record-alternation variants.
- The broader focused approval/security run passed 50 files and 248 tests; `node node_modules/typescript/bin/tsc --noEmit` and focused Biome checks also passed.
