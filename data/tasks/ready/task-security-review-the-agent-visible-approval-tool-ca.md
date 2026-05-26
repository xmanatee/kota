---
id: task-security-review-the-agent-visible-approval-tool-ca
title: Security review: The agent-visible approval tool can approve and execute queued tool calls itself, so a model in the same session can bypass the intended human approval gate after a risky tool call is queued.
status: ready
priority: p1
area: security
summary: The agent-visible approval tool can approve and execute queued tool calls itself, so a model in the same session can bypass the intended human approval gate after a risky tool call is queued.
created_at: 2026-05-26T14:54:53.312Z
updated_at: 2026-05-26T14:54:53.312Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/tools/approval.ts
claim: The agent-visible approval tool can approve and execute queued tool calls itself, so a model in the same session can bypass the intended human approval gate after a risky tool call is queued.

## Desired Outcome

Do not expose approve/execute as an agent-callable safe tool. Keep agent-side approval tooling read-only, and require operator-authenticated out-of-band resolution before a trusted runtime path executes the approved call.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-26T14-44-50-830Z-security-review-24xa9w.

finding id: security-review-approval-self-approval-bypass
candidate id: auth-approval-boundary:src/modules/approval-queue/cli.ts:118
verdict: confirmed
rationale: The queued tool result returns the approval id and instructs use of the approval tool. The approval tool's approve path calls queue.approve(id) and then raw executeTool(item.tool, item.input), bypassing the normal executeToolCalls guardrail path; its daemon-state write effect is classified as safe when the tool is exposed.

Evidence:

- src/core/tools/tool-runner.ts:222 - content: `Queued for approval [${queued.id}]: ${block.name} — ${autonomyDecision.reason}. ` +
- src/core/tools/tool-runner.ts:223 - "Use the approval tool to list and approve pending items.",
- src/core/tools/approval.ts:62 - const item = queue.approve(id);
- src/core/tools/approval.ts:65 - const result = await executeTool(item.tool, item.input);
- src/core/tools/approval.ts:91 - effect: daemonWriteEffect(),

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
