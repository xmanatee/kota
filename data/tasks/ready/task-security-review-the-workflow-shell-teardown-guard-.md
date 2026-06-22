---
id: task-security-review-the-workflow-shell-teardown-guard-
title: Security review: The workflow shell teardown guard only denies a narrow set of command forms, so direct destructive equivalents such as `git restore .`, `git checkout -- src`, and `terraform apply -destroy -auto-approve` fall through as allowed workflow-agent shell calls.
status: ready
priority: p1
area: security
summary: The workflow shell teardown guard only denies a narrow set of command forms, so direct destructive equivalents such as `git restore .`, `git checkout -- src`, and `terraform apply -destroy -auto-approve` fall through as allowed workflow-agent shell calls.
created_at: 2026-06-22T18:06:47.818Z
updated_at: 2026-06-22T18:06:47.818Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/agent-harness/guards.ts
claim:

> The workflow shell teardown guard only denies a narrow set of command forms, so direct destructive equivalents such as `git restore .`, `git checkout -- src`, and `terraform apply -destroy -auto-approve` fall through as allowed workflow-agent shell calls.

## Desired Outcome

> Extend the classifier and tests to deny common direct destructive equivalents, especially `terraform apply -destroy` and Git worktree-discard forms such as `git restore .` or `git checkout -- <path>`, while preserving benign branch checkout and read-only commands.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T16-40-20-747Z-security-review-k2b3dd.

finding id: workflow-shell-teardown-guard-misses-direct-destructive-equivalents
candidate id: task-workflow-mutation:src/core/agent-harness/guards.ts:20
verdict: confirmed
rationale:

> classifyWorkflowShellTeardownCommand currently denies only git reset --hard, git checkout -- ., forced git clean, and terraform/pulumi/cdk destroy subcommands. There is no git restore matcher, path checkout discard such as git checkout -- src does not match the dot-only checkout pattern, and terraform apply -destroy is outside the infrastructure destroy pattern.

Evidence:

Evidence 1:



path: src/core/agent-harness/guards.ts

line: 96

excerpt:



> const GIT_RESET_HARD_PATTERN =

Evidence 2:



path: src/core/agent-harness/guards.ts

line: 99

excerpt:



> const GIT_CHECKOUT_DISCARD_ALL_PATTERN =

Evidence 3:



path: src/core/agent-harness/guards.ts

line: 105

excerpt:



> const INFRASTRUCTURE_DESTROY_PATTERN =

Evidence 4:



path: src/core/agent-harness/guards.ts

line: 139

excerpt:



> if (

Evidence 5:



path: src/core/agent-harness/guards.ts

line: 146

excerpt:



> if (INFRASTRUCTURE_DESTROY_PATTERN.test(normalized)) return "infrastructure";

Evidence 6:



path: src/core/agent-harness/guards.ts

line: 216

excerpt:



> if (kind === null) {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
