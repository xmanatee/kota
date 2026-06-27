---
id: task-security-review-the-merge-conflict-resolver-runs-a
title: Security review: The merge-conflict resolver runs an autonomous agent in a worktree that can contain untrusted conflict text, but it only applies the broad workflow guard stack and does not enforce a resolver-specific read/write/tool boundary before the agent acts. A prompt injection in a conflicted file could run non-blocked shell/network commands or inspect copied ignored setup files before the post-run merge-boundary checks see filesystem state.
status: ready
priority: p2
area: security
summary: The merge-conflict resolver runs an autonomous agent in a worktree that can contain untrusted conflict text, but it only applies the broad workflow guard stack and does not enforce a resolver-specific read/write/tool boundary before the agent acts. A prompt injection in a conflicted file could run non-blocked shell/network commands or inspect copied ignored setup files before the post-run merge-boundary checks see filesystem state.
created_at: 2026-06-27T11:37:57.710Z
updated_at: 2026-06-27T11:37:57.710Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts
claim:

> The merge-conflict resolver runs an autonomous agent in a worktree that can contain untrusted conflict text, but it only applies the broad workflow guard stack and does not enforce a resolver-specific read/write/tool boundary before the agent acts. A prompt injection in a conflicted file could run non-blocked shell/network commands or inspect copied ignored setup files before the post-run merge-boundary checks see filesystem state.

## Desired Outcome

> Add a resolver-specific containment policy before invoking the harness: allow only the minimal file-read/edit tools needed for listed conflict paths, deny shell/network and git-mutating commands for this resolver, and prevent access to copied ignored setup files unless explicitly required. Keep the existing post-run boundary checks as defense in depth.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-27T10-17-38-629Z-security-review-mgbml1.

finding id: security-review-merge-resolver-tool-scope
candidate id: tool-execution:src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts:124
verdict: confirmed
rationale:

> Confirmed. The resolver runs the agent in the merge worktree with autonomyMode="autonomous" and passes only AUTONOMY_DISALLOWED_TOOLS plus createWorkflowAgentGuards, with no allowedTools or resolver-specific path/tool boundary (src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts:119, src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts:123, src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts:127). The disallow list only names Agent, Task, EnterWorktree, and ExitWorktree (src/modules/autonomy/shared.ts:103), while the shared guard stack covers daemon control, shell teardown, git commit, and package bootstrap, allowing other shell/tool calls (src/core/agent-harness/guards.ts:192). The merge gate validates staged/index/unstaged/untracked path boundaries only after the resolver returns (src/modules/git/worktree-merge-gate.ts:132, src/modules/git/worktree-merge-gate.ts:161, src/modules/git/worktree-merge-gate-finalize.ts:192), so it does not prevent runtime reads or non-blocked shell/network side effects. Ignored setup files can also be copied into the worktree before the agent runs (src/modules/git/worktree-lifecycle-support.ts:178).

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts

line: 26

excerpt:



> Resolve only the textual Git conflict files listed by the merge gate.

Evidence 2:



path: src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts

line: 119

excerpt:



> cwd: request.workspaceDir,

Evidence 3:



path: src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts

line: 124

excerpt:



> disallowedTools: AUTONOMY_DISALLOWED_TOOLS,

Evidence 4:



path: src/modules/autonomy/shared.ts

line: 103

excerpt:



> export const AUTONOMY_DISALLOWED_TOOLS = ["Agent", "Task", "EnterWorktree", "ExitWorktree"];

Evidence 5:



path: src/core/agent-harness/guards.ts

line: 192

excerpt:



> return composeCanUseTools(

Evidence 6:



path: src/modules/git/worktree-lifecycle-support.ts

line: 194

excerpt:



> copySafePath(entry.source, entry.target);

Evidence 7:



path: src/modules/git/worktree-merge-gate-finalize.ts

line: 225

excerpt:



> const unexpectedUnstaged = unstagedPaths(workspaceDir).filter((path) => !allowedConflictPaths.has(path));

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
