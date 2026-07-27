---
id: task-security-review-each-project-owns-a-distinct-appro
title: Security review: Each project owns a distinct approval queue, but constructing an AgentSession replaces the process-global queue singleton with that session's project queue. Tool approval enqueueing ignores the supplied scope and uses the current singleton, so concurrent multi-project sessions can place project A's approval in project B's queue, where it may be reviewed and replayed against the wrong project.
status: done
priority: p1
area: security
task_class: Safety
summary: Each project owns a distinct approval queue, but constructing an AgentSession replaces the process-global queue singleton with that session's project queue. Tool approval enqueueing ignores the supplied scope and uses the current singleton, so concurrent multi-project sessions can place project A's approval in project B's queue, where it may be reviewed and replayed against the wrong project.
created_at: 2026-07-27T10:43:55.804Z
updated_at: 2026-07-27T21:56:05.785Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/loop/loop-constructor.ts
claim:

> Each project owns a distinct approval queue, but constructing an AgentSession replaces the process-global queue singleton with that session's project queue. Tool approval enqueueing ignores the supplied scope and uses the current singleton, so concurrent multi-project sessions can place project A's approval in project B's queue, where it may be reviewed and replayed against the wrong project.

## Desired Outcome

> Remove singleton rebinding from scoped session execution. Pass the owning ProjectRuntime approval queue through ToolCallExecutionOptions or resolve it strictly from scopeId, persist scope attribution on approvals, and reject replay when the selected project differs. Add a concurrent two-project regression covering enqueue, listing, approval, and execution.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-27T09-34-53-266Z-security-review-lgkie5.

finding id: multi-project-approval-singleton-rebinding
candidate id: auth-approval-boundary:src/core/loop/loop-constructor.ts:5
verdict: confirmed
rationale:

> At HEAD 77a6de4b2, initAgentSession still replaces the global approval queue with options.projectRuntime.approvalQueue, while enqueueToolApproval resolves getApprovalQueue() and accepts no scope-aware queue. A two-queue probe bound project A and then project B before enqueueing a request attributed to project-a-session; project A retained zero approvals and project B received one approval carrying the project-A session id.

Evidence:

Evidence 1:



path: src/core/daemon/project-runtime.ts

line: 126

excerpt:



> const approvalQueue = new ApprovalQueue(join(projectDir, ".kota", "approvals"), pbus);

Evidence 2:



path: src/core/loop/loop-constructor.ts

line: 127

excerpt:



> setApprovalQueueInstance(options.projectRuntime.approvalQueue);

Evidence 3:



path: src/core/loop/loop-send.ts

line: 259

excerpt:



> sessionId: state.sessionId, scopeId: state.scopeId, projectId: state.scopeId,

Evidence 4:



path: src/core/tools/tool-runner-approval-queue.ts

line: 24

excerpt:



> return getApprovalQueue().enqueue(

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- The owning `ApprovalQueue` is passed through classic sessions, workflow
  runs, hosted harnesses, and the shared tool runner; no session rebinds the
  process singleton. Persisted approvals carry `scopeId`, and execution rejects
  a queue item whose scope differs from the selected project.
- `pnpm exec tsc -p tsconfig.json --noEmit` passed.
- Focused approval regression: 4 files and 84 tests passed, including the
  concurrent two-project enqueue/list/approve/execute boundary.
