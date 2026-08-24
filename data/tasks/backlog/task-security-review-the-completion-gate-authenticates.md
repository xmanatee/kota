---
id: task-security-review-the-completion-gate-authenticates
title: Bind production replacement proof to committed Git blobs
status: backlog
priority: p1
area: security
task_class: Safety
depends_on: [task-security-review-a-task-authored-artifact-can-decla]
summary: Execute replacement proof from an isolated Git snapshot and require the terminal commit to contain the exact tested entrypoint and test blobs.
created_at: 2026-08-23T07:37:13.578Z
updated_at: 2026-08-24T02:20:06.079Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/repo-tasks/production-replacement-completion.ts
claim:

> The completion gate authenticates only the evidence JSON against Git. Declared tests and production entrypoints merely need to exist as regular files in the current working tree, so ignored or untracked files can satisfy the proof and then be absent from the terminal commit or a clean checkout while the task remains durably marked done.

## Desired Outcome

> Exact-stage every declared test and entrypoint before evaluation, bind their Git blob IDs into the evidence, and execute from an isolated checkout of that index snapshot. Reject completion unless the final commit contains the same blobs.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-23T07-25-44-834Z-security-review-j8wkmk.

finding id: production-replacement-tests-are-not-bound-to-durable-blobs
candidate id: tool-execution:src/modules/repo-tasks/production-replacement-completion.ts:1
verdict: confirmed
rationale:

> Production tests and entrypoints are validated only as present, nonempty regular files; the Git index and worktree-consistency checks apply solely to the evidence artifact. The successful transition fixture itself writes the src proof files after repository initialization without adding them to Git, then permits the task move after staging only the artifact. The task transition stages its task paths, so proof code can remain absent from the durable commit.

Evidence:

Evidence 1:



path: src/modules/repo-tasks/production-replacement-completion.ts

line: 82

excerpt:



> productionTests are checked only with resolveRepoFile(...), which verifies current filesystem existence.

Evidence 2:



path: src/modules/repo-tasks/production-replacement-completion.ts

line: 87

excerpt:



> productionEntrypoints likewise receive only the current-filesystem resolveRepoFile check.

Evidence 3:



path: src/modules/repo-tasks/production-replacement-completion.ts

line: 99

excerpt:



> isIndexedRepoFile is applied to artifactPath only; no equivalent Git/index binding is applied to tests or entrypoints.

Evidence 4:



path: src/modules/repo-tasks/repo-tasks-domain.ts

line: 740

excerpt:



> After the transient proof passes, the task status is changed to done without recording the tested source blob identities.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
