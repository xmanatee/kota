---
id: task-security-review-the-git-tool-accepts-branch-d-name
title: Security review: The Git tool accepts `branch -D <name>` and deletes an unmerged branch, but invocation-specific effect resolution handles only pushes. The deletion therefore retains the moderate static effect and is allowed by default instead of entering the dangerous confirmation or approval queue. A fresh probe confirmed deletion of a branch whose tip differed from main.
status: ready
priority: p2
area: security
task_class: Safety
summary: The Git tool accepts `branch -D <name>` and deletes an unmerged branch, but invocation-specific effect resolution handles only pushes. The deletion therefore retains the moderate static effect and is allowed by default instead of entering the dangerous confirmation or approval queue. A fresh probe confirmed deletion of a branch whose tip differed from main.
created_at: 2026-07-24T19:04:07.850Z
updated_at: 2026-07-24T19:04:07.850Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/git/push-safety.ts
claim:

> The Git tool accepts `branch -D <name>` and deletes an unmerged branch, but invocation-specific effect resolution handles only pushes. The deletion therefore retains the moderate static effect and is allowed by default instead of entering the dangerous confirmation or approval queue. A fresh probe confirmed deletion of a branch whose tip differed from main.

## Desired Outcome

> Resolve branch deletion invocations to `localDestructiveEffect`, including at least forced deletion, and add a guardrail regression proving `branch -D` is classified dangerous before execution.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-24T18-41-20-702Z-security-review-rg2whe.

finding id: git-branch-delete-missing-destructive-effect
candidate id: tool-execution:src/modules/git/git-arguments-security.test.ts:1
verdict: confirmed
rationale:

> Confirmed. `src/modules/git/git-arguments.ts:246` accepts forced deletion, and `src/modules/git/git.ts:239` executes `git branch -D`. `src/modules/git/push-safety.ts:186` resolves invocation-specific effects only for pushes, leaving branch deletion at the moderate static effect from `src/modules/git/index.ts:66`. A fresh probe classified the invocation as moderate and deleted an unmerged branch.

Evidence:

Evidence 1:



path: src/modules/git/git-arguments.ts

line: 246

excerpt:



> if (action === "-d" || action === "-D") {

Evidence 2:



path: src/modules/git/git.ts

line: 246

excerpt:



> const result = await git(
>     ["branch", parsed.value.force ? "-D" : "-d", "--", parsed.value.name],

Evidence 3:



path: src/modules/git/push-safety.ts

line: 186

excerpt:



> export const resolveGitToolEffect: ToolEffectResolver = (input) => {
>  const operation = typeof input.op === "string" ? input.op : "";
>  if (operation !== "push") return undefined;

Evidence 4:



path: src/modules/git/index.ts

line: 66

excerpt:



> effect: networkWriteEffect(),

Evidence 5:



path: src/core/tools/guardrails.ts

line: 43

excerpt:



> const DEFAULT_POLICIES: Record<RiskLevel, Policy> = {
>   safe: "allow",
>   moderate: "allow",
>   dangerous: "confirm",

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
