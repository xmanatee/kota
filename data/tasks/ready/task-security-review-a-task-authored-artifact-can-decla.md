---
id: task-security-review-a-task-authored-artifact-can-decla
title: Bound production replacement assertion execution
status: ready
priority: p1
area: security
task_class: Safety
summary: Bound assertion cardinality, aggregate runtime, resources, and daemon blocking before task-authored replacement proof can execute.
created_at: 2026-08-23T07:37:13.619Z
updated_at: 2026-08-24T02:26:39.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/repo-tasks/production-replacement-execution.ts
claim:

> A task-authored artifact can declare an unbounded number of unique assertion bindings. The authenticated task-move route processes them synchronously, spawning one blocking Vitest run per binding with an individual 30-minute timeout and no aggregate deadline, allowing queue mutation to stall the daemon event loop for an effectively unbounded period.

## Desired Outcome

> Cap declaration and binding counts, impose one short aggregate execution budget, deduplicate before admission, and run proofs asynchronously in a bounded worker so task routes and daemon dispatch remain responsive.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-23T07-25-44-834Z-security-review-j8wkmk.

finding id: production-replacement-proof-can-block-daemon-unboundedly
candidate id: tool-execution:src/modules/repo-tasks/production-replacement-task-move.test.ts:1
verdict: confirmed
rationale:

> Declaration and artifact validation impose no cardinality limit on ingress or retired-boundary bindings. After deduplication, every unique path-and-name binding causes another synchronous Vitest invocation with its own 30-minute timeout. The task-move route calls this path inline and there is no aggregate deadline or worker isolation, making total blocking time proportional to an attacker-controlled binding count.

Evidence:

Evidence 1:



path: src/modules/repo-tasks/production-replacement-evidence.ts

line: 130

excerpt:



> retiredBoundary.tests is required to be non-empty but has no maximum length.

Evidence 2:



path: src/modules/repo-tasks/production-replacement-execution.ts

line: 219

excerpt:



> All ingress and retired-boundary bindings are collected into a map without a cardinality limit.

Evidence 3:



path: src/modules/repo-tasks/production-replacement-execution.ts

line: 236

excerpt:



> for (const binding of boundAssertions.values()) { const isolatedExecution = executeVitest(...); }

Evidence 4:



path: src/modules/repo-tasks/production-replacement-execution.ts

line: 65

excerpt:



> Each synchronous child invocation has its own timeout of 30 * 60 * 1000 milliseconds.

Evidence 5:



path: src/modules/repo-tasks/routes-lifecycle-handlers.ts

line: 111

excerpt:



> The HTTP handler calls moveTaskById directly, so synchronous proof execution blocks request and daemon progress.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
