---
id: task-security-review-the-task-move-path-accepts-unvalid
title: Security review: The task move path accepts unvalidated task ids and passes them into filesystem and git path construction. Encoded slash or traversal-shaped ids are rejected by the show route, but the move route and local client reach moveTaskById without the same canonical task-id guard.
status: ready
priority: p3
area: security
summary: The task move path accepts unvalidated task ids and passes them into filesystem and git path construction. Encoded slash or traversal-shaped ids are rejected by the show route, but the move route and local client reach moveTaskById without the same canonical task-id guard.
created_at: 2026-06-29T18:16:21.058Z
updated_at: 2026-06-29T18:16:21.058Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/repo-tasks/repo-tasks-domain.ts
claim:

> The task move path accepts unvalidated task ids and passes them into filesystem and git path construction. Encoded slash or traversal-shaped ids are rejected by the show route, but the move route and local client reach moveTaskById without the same canonical task-id guard.

## Desired Outcome

> Add an isRepoTaskId guard at the move boundary and inside moveTaskById so every caller gets the same protection. Return a client error for invalid ids and add regression coverage for encoded slash ids on PATCH /api/tasks/:id/move plus local-client/CLI move.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-29T17-47-42-922Z-security-review-bhte00.

finding id: repo-task-move-unvalidated-id
candidate id: task-workflow-mutation:src/modules/repo-tasks/repo-tasks-domain.ts:2
verdict: confirmed
rationale:

> Confirmed. The show route rejects non-canonical task ids with isRepoTaskId, but handleTaskMove forwards params.id directly to moveTaskById, and the local client path does the same. The shared route matcher decodes percent-encoded segments, so encoded slash or traversal-shaped ids can reach moveTaskById, which interpolates the id into join(tasksDir, state, `${id}.md`) and later git mv path arguments without validating against REPO_TASK_ID_PATTERN.

Evidence:

Evidence 1:



path: src/modules/repo-tasks/routes-lifecycle-handlers.ts

line: 84

excerpt:



> if (!isRepoTaskId(id)) { jsonResponse(res, 400, { error: "Invalid task id" }); return; }

Evidence 2:



path: src/modules/repo-tasks/routes-lifecycle-handlers.ts

line: 114

excerpt:



> const result = moveTaskById(projectDir, id, state);

Evidence 3:



path: src/modules/repo-tasks/index.ts

line: 167

excerpt:



> const result = moveTaskById(resolved.projectDir, id, toState);

Evidence 4:



path: src/modules/repo-tasks/repo-tasks-domain.ts

line: 544

excerpt:



> const candidate = join(tasksDir, state, `${id}.md`);

Evidence 5:



path: src/modules/repo-tasks/repo-tasks-domain.ts

line: 574

excerpt:



> execFileSync("git", ["mv", fromPath, dstPath], {

Evidence 6:



path: src/modules/repo-tasks/task-id.ts

line: 1

excerpt:



> export const REPO_TASK_ID_PATTERN = /^task-[a-z0-9-]+$/;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
