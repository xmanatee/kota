---
id: task-security-review-the-gemini-and-vercel-kota-hosted-
title: Security review: The Gemini and Vercel KOTA-hosted tool loops execute registered tools directly, bypassing the shared effect assessment, configured guardrail policy, confirmation, and approval-queue path. In autonomous mode, where per-tool guardrail policy is supposed to decide, a dangerous tool can execute even when its policy requires confirmation or denial.
status: ready
priority: p1
area: security
task_class: Safety
summary: The Gemini and Vercel KOTA-hosted tool loops execute registered tools directly, bypassing the shared effect assessment, configured guardrail policy, confirmation, and approval-queue path. In autonomous mode, where per-tool guardrail policy is supposed to decide, a dangerous tool can execute even when its policy requires confirmation or denial.
created_at: 2026-07-27T10:43:55.794Z
updated_at: 2026-07-27T10:43:55.794Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/gemini-agent-harness/tool-loop.ts
claim:

> The Gemini and Vercel KOTA-hosted tool loops execute registered tools directly, bypassing the shared effect assessment, configured guardrail policy, confirmation, and approval-queue path. In autonomous mode, where per-tool guardrail policy is supposed to decide, a dangerous tool can execute even when its policy requires confirmation or denial.

## Desired Outcome

> Route Gemini and Vercel tool calls through the shared permissioned tool-execution primitive, including autonomy mode, guardrailsConfig, client approval, scoped approval queue, idempotency, and telemetry. Add regressions proving dangerous tools honor deny, confirm, and queue policies across every KOTA-hosted adapter.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-27T09-34-53-266Z-security-review-lgkie5.

finding id: agent-harness-kota-tool-loop-guardrail-bypass
candidate id: tool-execution:src/modules/gemini-agent-harness/tool-loop.ts:120
verdict: confirmed
rationale:

> At HEAD 77a6de4b2, the shared executeToolBlock path classified a registered destructive tool as dangerous and denied it under a dangerous=deny policy, while dispatchFunctionCall in the Gemini adapter and Tool.execute in the Vercel adapter each executed the same-shape destructive tool once. Both adapter paths call executeTool directly after catalog/canUseTool checks and do not route guardrailsConfig, autonomy gating, confirmation, approval queueing, idempotency, middleware, or tool-execution metrics through executeToolBlock.

Evidence:

Evidence 1:



path: src/core/tools/autonomy-mode.ts

line: 14

excerpt:



> - `autonomous` — today's behavior: per-tool guardrail policy decides.

Evidence 2:



path: src/core/tools/tool-runner-execute-block.ts

line: 92

excerpt:



> const assessment = guardrailsConfig ? assess(block.name, input, guardrailsConfig) : assess(block.name, input);

Evidence 3:



path: src/modules/gemini-agent-harness/tool-loop.ts

line: 205

excerpt:



> const result = maskToolResultSecrets(await executeTool(name, effectiveInput, {

Evidence 4:



path: src/modules/vercel-agent-harness/adapter-tools.ts

line: 113

excerpt:



> const result = maskToolResultSecrets(await executeTool(kotaTool.name, effectiveInput, {

Evidence 5:



path: src/core/agent-harness/guards.ts

line: 192

excerpt:



> export function createWorkflowAgentGuards(): AgentCanUseTool { return composeCanUseTools(createDaemonHostControlGuard(), createWorkflowShellTeardownGuard(), createAgentCommitGuard(), createPackageBootstrapGuard()); }

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
