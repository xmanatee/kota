---
status: done
---

# Security review: Confirmed security-review findings can be written into an existing done or dropped task instead of reopening or creating an actionable task, so recurring or slug-colliding vulnerabilities may be recorded as handled while no ready security task exists.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/security-review/security-review-tasks.ts
claim:

> Confirmed security-review findings can be written into an existing done or dropped task instead of reopening or creating an actionable task, so recurring or slug-colliding vulnerabilities may be recorded as handled while no ready security task exists.

## Desired Outcome

> For confirmed findings, treat existing terminal tasks as closed history: move/reopen them to ready or create a new ready task with a unique id, and do not count updates to done or dropped tasks as actionable remediation. Add regression coverage for a repeated confirmed finding whose previous task is in done and for a slug collision with a terminal task.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-20T01-58-31-925Z-security-review-uzg22d.

finding id: security-review-terminal-task-suppression
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/security-review/security-review-tasks.ts:222
verdict: confirmed
rationale:

> Confirmed. `findExistingTask` searches every repo task state, including terminal `done` and `dropped` states from `REPO_TASK_STATES`. `createOrUpdateSecurityFindingTasks` then preserves `existing.state` and `existing.path`, writes the confirmed finding back to that terminal file, and reports it through `updatedTaskIds`. The workflow counts `updatedTaskIds` as confirmed remediation work, while queue snapshots exclude `done` and `dropped` from open/actionable counts, so a repeated confirmed finding can be recorded without producing actionable ready work.

Evidence:

Evidence 1:

path: src/modules/repo-tasks/repo-tasks-domain.ts

line: 25

excerpt:

> export const REPO_TASK_STATES = [

Evidence 2:

path: src/modules/autonomy/workflows/security-review/security-review-tasks.ts

line: 90

excerpt:

> for (const state of REPO_TASK_STATES) {

Evidence 3:

path: src/modules/autonomy/workflows/security-review/security-review-tasks.ts

line: 205

excerpt:

> const state = existing?.state ?? "ready";

Evidence 4:

path: src/modules/autonomy/workflows/security-review/security-review-tasks.ts

line: 206

excerpt:

> const taskPath = existing?.path ?? join(getRepoTaskStateDir(projectDir, "ready"), `${id}.md`);

Evidence 5:

path: src/modules/autonomy/workflows/security-review/workflow.ts

line: 315

excerpt:

> const confirmedCount = result.createdTaskIds.length + result.updatedTaskIds.length;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/autonomy/workflows/security-review/workflow.test.ts` passed with 19 tests.
- `pnpm exec biome check src/modules/autonomy/workflows/security-review/security-review-tasks.ts src/modules/autonomy/workflows/security-review/workflow.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm validate-tasks` passed after staging the task move.
