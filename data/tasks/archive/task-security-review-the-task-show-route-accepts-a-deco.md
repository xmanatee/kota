---
status: done
---

# Security review: The task show route accepts a decoded route id and passes it into direct filesystem path construction, so an authenticated request with encoded slash and dot-dot segments can read markdown files outside data/tasks.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/repo-tasks/routes.ts
claim:

> The task show route accepts a decoded route id and passes it into direct filesystem path construction, so an authenticated request with encoded slash and dot-dot segments can read markdown files outside data/tasks.

## Desired Outcome

> Reject task ids containing path separators, dot-dot segments, or absolute-path forms before any filesystem helper runs, or resolve and verify the normalized path remains under the expected task state directory. Add route/domain regression coverage for encoded slash traversal such as %2E%2E%2F.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T00-29-09-611Z-security-review-w967o1.

finding id: repo-tasks-route-id-path-traversal
candidate id: tool-execution:src/modules/repo-tasks/routes.ts:1
verdict: confirmed
rationale:

> The current route matcher decodes percent-encoded route parameters after splitting path segments, so /api/tasks/%2E%2E%2F%2E%2E%2F%2E%2E%2FAGENTS matches /api/tasks/:id with an id containing ../ path separators. The GET /api/tasks/:id handler passes params.id directly to handleTaskShow, and showTask joins that id into data/tasks/<state>/<id>.md without validation or containment checks. In the current tree this resolves to the project-root AGENTS.md, confirming markdown reads outside data/tasks are possible.

Evidence:

Evidence 1:

path: src/core/modules/route-matcher.ts

line: 21

excerpt:

> function safeDecode(segment: string): string {

Evidence 2:

path: src/core/modules/route-matcher.ts

line: 57

excerpt:

> params[segment.slice(1)] = safeDecode(pathParts[i]);

Evidence 3:

path: src/modules/repo-tasks/routes.ts

line: 729

excerpt:

> path: "/api/tasks/:id",

Evidence 4:

path: src/modules/repo-tasks/routes.ts

line: 737

excerpt:

> return handleTaskShow(res, params.id, project.projectDir);

Evidence 5:

path: src/modules/repo-tasks/repo-tasks-operations.ts

line: 63

excerpt:

> const filePath = join(tasksDir, state, `${id}.md`);

Evidence 6:

path: src/modules/repo-tasks/repo-tasks-operations.ts

line: 68

excerpt:

> content: readFileSync(filePath, "utf-8"),

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/repo-tasks/repo-tasks-operations.test.ts src/modules/repo-tasks/routes.test.ts src/modules/repo-tasks/task-dependencies.test.ts` passed on 2026-06-22 with 55 tests.
- `pnpm typecheck` passed on 2026-06-22.
- `pnpm lint` passed on 2026-06-22.
