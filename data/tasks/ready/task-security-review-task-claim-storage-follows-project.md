---
id: task-security-review-task-claim-storage-follows-project
title: Security review: Task-claim storage follows project-controlled directory symlinks. A project can redirect .kota/task-claims/active, history, or locks into another project, causing host-side claim reads, writes, renames, and archival to cross the project boundary.
status: ready
priority: p1
area: security
task_class: Safety
summary: Task-claim storage follows project-controlled directory symlinks. A project can redirect .kota/task-claims/active, history, or locks into another project, causing host-side claim reads, writes, renames, and archival to cross the project boundary.
created_at: 2026-08-06T12:54:42.988Z
updated_at: 2026-08-06T12:54:42.988Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/task-claim-files.ts
claim:

> Task-claim storage follows project-controlled directory symlinks. A project can redirect .kota/task-claims/active, history, or locks into another project, causing host-side claim reads, writes, renames, and archival to cross the project boundary.

## Desired Outcome

> Move claim reads, writes, locks, listing, and archival behind a descriptor-anchored no-follow boundary rooted at the canonical .kota/task-claims directory. Reject symlinked or non-directory components and symlinked/non-regular claim entries, perform leaf operations relative to verified directories, and verify that the stored taskId matches the requested filename. Add sibling-project active/history/locks symlink regressions proving no cross-project read, write, replacement, or removal occurs.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-06T11-39-01-012Z-security-review-6w0q2w.

finding id: task-claim-store-symlink-cross-project-write
candidate id: task-workflow-mutation:src/modules/autonomy/task-claim-files.ts:10
verdict: confirmed
rationale:

> Task-claim paths are lexical joins beneath projectDir, while ensureParent, readClaimFile, listTaskClaimInspections, writeClaim, lock creation, and archiveClaim use ordinary filesystem operations without lstat, O_NOFOLLOW, canonical-root, or descriptor-relative enforcement. Symlinked active, history, or locks directories therefore redirect host-authority reads and mutations across project boundaries. Existing path-security tests protect data/tasks, not .kota/task-claims.

Evidence:

Evidence 1:



path: src/modules/autonomy/task-claim-files.ts

line: 40

excerpt:



> taskClaimPath constructs the active-claim pathname with join(projectDir, ACTIVE_CLAIMS_DIR, ...), and ensureParent uses recursive mkdir without verifying that any directory component is real and beneath the project.

Evidence 2:



path: src/modules/autonomy/task-claim-files.ts

line: 141

excerpt:



> readClaimFile calls readFileSync(path, "utf8") directly, so a linked active directory or claim entry is followed with workflow-host filesystem authority.

Evidence 3:



path: src/modules/autonomy/task-claim-files.ts

line: 216

excerpt:



> writeClaim creates its temporary file at a pathname derived from the unverified parent and installs it with linkSync or renameSync, allowing a linked claim directory to redirect the write.

Evidence 4:



path: src/modules/autonomy/task-claim-files.ts

line: 418

excerpt:



> archiveClaim computes a separate unverified history pathname and calls renameSync(path, historyPath), which can remove or relocate another project's active claim when either claim directory is linked.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
