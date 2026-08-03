---
id: task-implement-the-revisioned-observable-scope-policy-a
title: Implement the revisioned observable scope-policy authority
status: ready
priority: p1
area: security
task_class: Safety
summary: Replace unversioned scope-policy state with a single authority that atomically returns policy and revision, advances revisions on mutations, and publishes restrictive transitions.
depends_on: [task-define-exhaustive-scope-policy-restriction-semanti]
created_at: 2026-08-03T15:31:42.493Z
updated_at: 2026-08-03T15:31:42.493Z
---

## Problem

    Current consumers receive an unversioned policy object and cannot determine whether it remains authoritative after policy state changes.

## Desired Outcome

    Core owns one live scope-policy authority whose reads return an atomic policy-and-revision snapshot and whose mutations monotonically advance revisions while notifying subscribers when the transition classifier identifies a restriction.

## Constraints

- Use the exhaustive transition semantics delivered by the preceding subtask.
- Maintain one canonical policy source; remove or migrate the unversioned storage path instead of wrapping it with a parallel authority.
- Make the policy and revision observable as one atomic snapshot.
- Advance revisions monotonically for actual policy changes, including permissive changes, while treating equal replacement as a no-op.
- Restrictive notifications must identify the relevant before and after revisions and snapshots without granting new authorization.
- Do not bypass approval, tool-risk, secret-handling, injection-defense, or autonomy gates.

## Done When

- Scope-policy reads return an atomic snapshot containing the policy and authority revision.
- Every actual policy mutation advances the revision monotonically and equal replacement does not create a false mutation.
- Restrictive mutations publish an observable event or subscription notification with sufficient revision context for active consumers.
- Equal and purely permissive mutations do not publish restrictive notifications.
- Focused tests prove atomic snapshots, monotonic revisions, notification ordering, and restrictive-only publication.
- The focused verification command and passing result are recorded in the task.

## Source / Intent

    Authority seam of task-add-revisioned-observable-scope-policy-authority, preserving the confirmed security-review requirement after builder run 2026-08-03T14-32-25-880Z-builder-1yp7jy exhausted repair.

Decomposed from `task-add-revisioned-observable-scope-policy-authority` after builder run `2026-08-03T14-32-25-880Z-builder-1yp7jy` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit tests for snapshot reads, mutation revisions, equal updates, permissive updates, restrictive updates, and subscriber delivery.
- Repository inspection or focused tests demonstrating that no parallel unversioned policy store remains.
- A recorded passing verification command for the authority contract.
