---
id: task-security-review-when-persistprofile-is-enabled-imp
title: Constrain browser profile persistence to the agent write scope
status: ready
priority: p1
area: security
task_class: Safety
summary: Await browser profile persistence, declare its filesystem effect, and reject targets that escape the effective agent write scope through symlinks or canonical paths.
created_at: 2026-08-15T18:12:16.685Z
updated_at: 2026-08-24T02:26:39.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/browser/lifecycle.ts
claim:

> When persistProfile is enabled, implicit browser-session teardown performs a fire-and-forget host write to the canonical profile path. Browser tools expose only external or daemon effects, while workflow agents are attributed against their workspace. A same-scope symlink-escaping profile path can therefore cause an untracked write outside the agent's declared write scope after harness execution returns.

## Desired Outcome

> Make session-resource cleanup awaitable and complete profile persistence before harness or workflow attribution ends. Declare persistence as a local-filesystem write bound to its resolved target, reject mutable symlink redirection with no-follow/identity checks, and prevent autonomous or worktree-backed agents from persisting to canonical-project paths outside their effective write scope.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-15T13-40-02-785Z-security-review-2yhnae.

finding id: browser-profile-persistence-write-boundary-bypass
candidate id: auth-approval-boundary:data/tasks/done/task-security-review-the-browser-module-keeps-one-proce.md:30
verdict: confirmed
rationale:

> Browser teardown registers a synchronous cleanup callback that discards closeSessionResource's promise, while unregisterSessionEnvironment invokes cleanup without awaiting it. closeSessionResource subsequently persists storage state asynchronously. The profile resolver intentionally permits absolute, project-escaping, and symlink-resolved external paths for the owning scope, and workflow browser identity uses canonical projectDir while write-scope snapshots inspect workspaceDir. Browser tools declare only external-network or daemon-state effects, so pre-execution local-write enforcement never sees the persistence target. Consequently profile persistence can complete outside both the declared agent write roots and the post-harness workspace mutation snapshot.

Evidence:

Evidence 1:



path: src/modules/browser/lifecycle.ts

line: 122

excerpt:



> resource.detachSessionCleanup = registerSessionEnvironmentResource(runnerContext, () => { void closeSessionResource(resource).catch(() => {}); });

Evidence 2:



path: src/modules/browser/lifecycle.ts

line: 202

excerpt:



> if (!resource.profile.persist || !resource.profile.storageStatePath) return; ... await resource.context.storageState({ path: resolved });

Evidence 3:



path: src/core/tools/session-environment.ts

line: 118

excerpt:



> for (const cleanup of resources) { try { cleanup(); } ... }

Evidence 4:



path: src/core/workflow/steps/step-executor-agent-run-options.ts

line: 113

excerpt:



> projectDir: agentConfig.projectDir, cwd: workspaceDir,

Evidence 5:



path: src/modules/browser/browser-profile.ts

line: 117

excerpt:



> return owner?.scopeId === identity.scopeId && owner.projectDir === identity.projectDir ? canonicalPath : null;

Evidence 6:



path: src/modules/browser/index.ts

line: 49

excerpt:



> effect: networkDestructiveEffect(),

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
