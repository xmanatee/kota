---
id: task-security-review-the-decomposer-follows-project-con
title: Security review: The decomposer follows project-controlled task symlinks before applying the new untrusted-content prompt envelope. A task entry can reference another readable project or external file, causing host-side code to read that target and include its contents in taskMarkdown sent to the agent. Screening and escaping prevent delimiter injection but do not prevent the prior cross-project disclosure.
status: ready
priority: p1
area: security
task_class: Safety
summary: The decomposer follows project-controlled task symlinks before applying the new untrusted-content prompt envelope. A task entry can reference another readable project or external file, causing host-side code to read that target and include its contents in taskMarkdown sent to the agent. Screening and escaping prevent delimiter injection but do not prevent the prior cross-project disclosure.
created_at: 2026-08-06T10:29:11.571Z
updated_at: 2026-08-06T10:29:11.571Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/workflows/decomposer/workflow.ts
claim:

> The decomposer follows project-controlled task symlinks before applying the new untrusted-content prompt envelope. A task entry can reference another readable project or external file, causing host-side code to read that target and include its contents in taskMarkdown sent to the agent. Screening and escaping prevent delimiter injection but do not prevent the prior cross-project disclosure.

## Desired Outcome

> Route all queue discovery and decomposer task reads through the descriptor-anchored, no-follow reader rooted at the canonical data/tasks directory. Reject symlinked parents and entries before claiming or agent dispatch, bind the claimed task to a verified file identity, and add a regression where a task symlink targets a sibling project's task or another external file and proves that no content reaches the agent prompt.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-06T08-30-07-704Z-security-review-8fp769.

finding id: decomposer-task-symlink-cross-project-read
candidate id: auth-approval-boundary:src/modules/autonomy/workflows/decomposer/workflow.ts:232
verdict: confirmed
rationale:

> The cited path remains exploitable. listFullRepoTasks follows task-directory and leaf symlinks with readFileSync, and claimNextQueueTask accepts the resulting record without binding it to a verified in-project file identity. After a qualifying builder failure, decomposer findTaskById uses existsSync and buildAssessment again follows the selected path with readFileSync. assess-failure is then exposed to the agent, including taskMarkdown. The untrusted-output envelope screens and escapes content only after the host read, so it cannot prevent disclosure of an external target. The repository already provides a descriptor-anchored no-follow reader, but this discovery and decomposer path does not use it.

Evidence:

Evidence 1:



path: src/modules/repo-tasks/repo-tasks-domain.ts

line: 412

excerpt:



> listFullRepoTasks enumerates project-controlled markdown entries and calls readFileSync(filePath, "utf-8") without rejecting a symlinked state directory or leaf entry.

Evidence 2:



path: src/modules/autonomy/task-claims.ts

line: 85

excerpt:



> claimNextQueueTask constructs autonomous claim candidates directly from listFullRepoTasks, allowing a followed external task target to become the active claimed task.

Evidence 3:



path: src/modules/autonomy/workflows/decomposer/workflow.ts

line: 75

excerpt:



> findTaskById accepts the expected task pathname using existsSync(candidate), which follows symbolic links and does not establish a regular-file identity beneath the project root.

Evidence 4:



path: src/modules/autonomy/workflows/decomposer/workflow.ts

line: 198

excerpt:



> buildAssessment assigns taskMarkdown using readFileSync(join(projectDir, task.path), "utf-8"), following the accepted task symlink with the workflow host's filesystem authority.

Evidence 5:



path: src/modules/autonomy/workflows/decomposer/workflow.ts

line: 203

excerpt:



> assess-failure exposes the resulting taskMarkdown to later agent steps; exposedOutputTrust marks it untrusted but cannot undo disclosure of bytes already read outside the selected project.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
