---
id: task-security-review-slack-approval-delivery-and-callba
title: Bind Slack approval delivery and callbacks to scope and digest
status: backlog
priority: p1
area: security
task_class: Safety
depends_on: [task-complete-the-terminal-project-to-scope-migration]
summary: Persist scope identity with Slack approval messages and verify scope, full approval ID, message binding, action, and digest for approve and reject.
created_at: 2026-08-15T04:06:48.982Z
updated_at: 2026-08-24T02:20:04.654Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/slack-channel/channel.ts
claim:

> Slack approval delivery and callbacks discard the approval event's project identity and use the unscoped active approvals client. A project-selection change or collision between the eight-character approval IDs can therefore surface or reject an approval belonging to another hosted scope; rejection is not protected by a review digest.

## Desired Outcome

> Resolve event delivery through `client.forScope(payload.scopeId)`, persist
> `scopeId` with the Slack channel/message binding, and use that same scoped
> client for callbacks. Bind both approve and reject actions to the scope,
> message, full approval ID, action, and review digest, failing closed on any
> mismatch.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-15T01-40-48-994Z-security-review-wz3svj.

finding id: security-review-slack-approval-scope-unbound
candidate id: auth-approval-boundary:src/modules/slack-channel/channel.ts:67
verdict: confirmed
rationale:

> Although approval.requested is project-attributed, channel.ts:66-72 discards that identity and queries moduleCtx.client.approvals without scope. Approval actions contain only verb, short ID, and optionally digest, then invoke the same unscoped client at approval-interactions.ts:23-39. The digest includes scope and protects approval, but rejection carries neither digest nor project binding. With independently generated eight-character IDs at approval-queue-item.ts:44 and a changed default scope, a collision can display or reject an approval from the wrong project.

Evidence:

Evidence 1:



path: src/core/events/event-bus-tail-events.ts

line: 6

excerpt:



> "approval.requested": { projectId: ProjectId; id: string; tool: string; risk: string; reason: string; source: string; sessionId: string; };

Evidence 2:



path: src/modules/slack-channel/channel.ts

line: 66

excerpt:



> const unsubscribeApproval = moduleCtx.events.subscribe("approval.requested", (payload) => { const id = payload.id as string; void moduleCtx.client.approvals.list({ status: "pending" }).then((listed) => { const approval = listed.approvals.find((item) => item.id === id);

Evidence 3:



path: src/modules/slack-channel/approval-interactions.ts

line: 23

excerpt:



> const [verb, id, reviewDigest] = (action.value ?? action.action_id).split(":");

Evidence 4:



path: src/modules/slack-channel/approval-interactions.ts

line: 38

excerpt:



> } else if (verb === "reject") { const result = await options.approvals.reject(id);

Evidence 5:



path: src/core/daemon/approval-queue-item.ts

line: 44

excerpt:



> id: randomUUID().slice(0, 8),

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
