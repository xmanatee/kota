---
id: task-security-review-normalized-task-creation-stages-th
title: Security review: Normalized task creation stages the new file through a shell-interpolated git command. Because the interpolated file path is derived from the project directory, a project path containing shell metacharacters can break out of the quoted argument and execute commands during task creation.
status: done
priority: p2
area: security
summary: Normalized task creation stages the new file through a shell-interpolated git command. Because the interpolated file path is derived from the project directory, a project path containing shell metacharacters can break out of the quoted argument and execute commands during task creation.
created_at: 2026-06-22T02:43:07.339Z
updated_at: 2026-06-22T03:58:30.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/repo-tasks/repo-tasks-operations.ts
claim:

> Normalized task creation stages the new file through a shell-interpolated git command. Because the interpolated file path is derived from the project directory, a project path containing shell metacharacters can break out of the quoted argument and execute commands during task creation.

## Desired Outcome

> Replace the shell string with execFileSync("git", ["add", filePath], ...) or a shared git-staging helper so project paths are passed as argv, not parsed by a shell.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T02-09-19-991Z-security-review-k6fva2.

finding id: repo-tasks-normalized-create-shell-interpolation
candidate id: tool-execution:src/modules/repo-tasks/repo-tasks-operations.ts:151
verdict: confirmed
rationale:

> Confirmed. createNormalizedTask derives filePath from the resolved projectDir at src/modules/repo-tasks/repo-tasks-operations.ts:124-127 and then passes it through execSync as a shell command at line 151. A project directory containing shell metacharacters such as command substitution is parsed by /bin/sh inside the quoted git add argument. Nearby route code uses execFileSync("git", ["add", filePath]) at src/modules/repo-tasks/routes-lifecycle-handlers.ts:66, which is the safer argv-based pattern.

Evidence:

Evidence 1:



path: src/modules/repo-tasks/repo-tasks-operations.ts

line: 124

excerpt:



> const tasksDir = getRepoTasksDir(projectDir);

Evidence 2:



path: src/modules/repo-tasks/repo-tasks-operations.ts

line: 127

excerpt:



> const filePath = join(stateDir, `${id}.md`);

Evidence 3:



path: src/modules/repo-tasks/repo-tasks-operations.ts

line: 151

excerpt:



> execSync(`git add "${filePath}"`, {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/repo-tasks/repo-tasks-operations.test.ts` passed: 1 file, 20 tests.
- `pnpm exec biome check src/modules/repo-tasks/repo-tasks-operations.ts src/modules/repo-tasks/repo-tasks-operations.test.ts` passed.
- `pnpm run typecheck` passed.
- `pnpm run validate-tasks` passed after staging the task move.
