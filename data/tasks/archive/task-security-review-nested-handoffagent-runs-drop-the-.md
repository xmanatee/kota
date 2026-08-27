---
status: done
---

# Security review: Nested handoff_agent runs drop the configured modelProvider/baseUrl/apiKey before launching the child harness, so a child agent can run against the provider implied by its model string instead of the operator-configured endpoint.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/tools/handoff-agent.ts
claim:

> Nested handoff_agent runs drop the configured modelProvider/baseUrl/apiKey before launching the child harness, so a child agent can run against the provider implied by its model string instead of the operator-configured endpoint.

## Desired Outcome

> Carry ModelProviderSelection through HandoffAgentRuntime and delegate/session config, pass it into the child runAgentHarness options, and add a regression test proving handoff_agent preserves configured provider/baseUrl/apiKey.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-23T14-27-59-282Z-security-review-v891ca.

finding id: handoff-model-provider-dropped
candidate id: auth-approval-boundary:src/core/tools/handoff-agent.ts:584
verdict: confirmed
rationale:

> Confirmed. Parent workflow agent runs build and pass AgentHarnessRunOptions.modelProvider from config at src/core/workflow/steps/step-executor-agent-run-options.ts:77 and :86, and the attempt stores that value in the handoff runtime object at src/core/workflow/steps/step-executor-agent-attempt.ts:112. HandoffAgentRuntime still has no declared modelProvider field at src/core/tools/handoff-agent-runtime.ts:12, and runHandoffAgent launches the child harness at src/core/tools/handoff-agent.ts:566 without passing modelProvider in the options object through line 587. ModelClient-backed harnesses consume only options.modelProvider when selecting provider/baseUrl/apiKey, for example src/modules/openai-tools-agent-harness/adapter.ts:407 and src/modules/thin-agent-harness/adapter.ts:143, so nested handoffs can fall back to provider/model notation or fail for unprefixed models instead of preserving the operator-configured modelProvider selection.

Evidence:

Evidence 1:

path: src/core/workflow/steps/step-executor-agent-run-options.ts

line: 31

excerpt:

> modelProviderSelection includes provider, baseUrl, and apiKey from config.modelProvider.

Evidence 2:

path: src/core/workflow/steps/step-executor-agent-attempt.ts

line: 112

excerpt:

> The parent workflow attempt adds modelProvider to the handoff runtime object.

Evidence 3:

path: src/core/tools/handoff-agent-runtime.ts

line: 12

excerpt:

> HandoffAgentRuntime declares cwd, harness, resolveAgentDef, modelOutputTokenLimits, delegateBudget, canUseTool, askOwner, tokenBudget, and transport, but no modelProvider.

Evidence 4:

path: src/core/tools/handoff-agent.ts

line: 566

excerpt:

> runHandoffAgent calls runAgentHarness for the child without passing modelProvider.

## Outcome

HandoffAgentRuntime now carries ModelProviderSelection explicitly, runHandoffAgent passes it to child harness runs, and the session/delegate/inbound-signal handoff paths preserve configured provider selection instead of falling back to model-string inference.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm test src/core/tools/handoff-agent.test.ts` passed: 1 file, 15 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm validate-tasks` passed after staging the completed task move.
