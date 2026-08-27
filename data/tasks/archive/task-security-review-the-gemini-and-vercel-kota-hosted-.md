---
status: done
---

# Security review: The Gemini and Vercel KOTA-hosted tool loops execute registered tools directly, bypassing the shared effect assessment, configured guardrail policy, confirmation, and approval-queue path. In autonomous mode, where per-tool guardrail policy is supposed to decide, a dangerous tool can execute even when its policy requires confirmation or denial.

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

- Security regression record: `.kota/runs/2026-07-27T11-17-55-291Z-builder-kra15l/security-regression.txt`.
- Final verification command: `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source ./node_modules/.bin/vitest run src/strict-types-policy.integration.test.ts src/core/agent-harness src/core/tools/tool-runner.test.ts src/core/tools/tool-runner-permission.test.ts src/core/tools/autonomy-mode-boundary.integration.test.ts src/modules/openai-tools-agent-harness src/modules/gemini-agent-harness src/modules/vercel-agent-harness --configLoader runner --reporter=dot`
- Result: 44 test files passed; 263 tests passed. TypeScript, Biome, and diff-check gates also passed.
