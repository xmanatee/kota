---
id: task-security-review-workflow-handoff-children-do-not-i
title: Security review: Workflow handoff children do not inherit the parent step's resolved scope policy. The child uses its caller-selected autonomy mode and inherits only the generic canUseTool guard. KOTA-hosted child tool execution therefore sees no scope policy and skips module, write-boundary, and external-effect enforcement. The outer handoff is classified only as a local filesystem write, so it cannot represent prohibited network effects performed by the child.
status: done
priority: p1
area: security
task_class: Safety
summary: Workflow handoff children do not inherit the parent step's resolved scope policy. The child uses its caller-selected autonomy mode and inherits only the generic canUseTool guard. KOTA-hosted child tool execution therefore sees no scope policy and skips module, write-boundary, and external-effect enforcement. The outer handoff is classified only as a local filesystem write, so it cannot represent prohibited network effects performed by the child.
created_at: 2026-08-04T00:24:52.556Z
updated_at: 2026-08-06T18:26:56.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/workflow/steps/step-executor-agent-attempt.ts
claim:

> Workflow handoff children do not inherit the parent step's resolved scope policy. The child uses its caller-selected autonomy mode and inherits only the generic canUseTool guard. KOTA-hosted child tool execution therefore sees no scope policy and skips module, write-boundary, and external-effect enforcement. The outer handoff is classified only as a local filesystem write, so it cannot represent prohibited network effects performed by the child.

## Desired Outcome

> Add the resolved scope policy, authority path, approval queue, and scope identity to HandoffAgentRuntime and every child AgentHarnessRunOptions. Cap child autonomy against both parent posture and scope policy. Either resolve the handoff tool's effect from the requested child capabilities or reject handoffs whose effects cannot be represented. Add regressions proving denied network, module, and write effects remain denied in KOTA-hosted children.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-03T22-34-27-866Z-security-review-nx0r95.

finding id: handoff-child-drops-scope-policy
candidate id: auth-approval-boundary:src/core/workflow/steps/step-executor-agent-attempt.ts:137
verdict: confirmed
rationale:

> The handoff runtime and child AgentHarnessRunOptions omit scopePolicy, authorityConfigPath, and approvalQueue. The child receives only named-tool controls and canUseTool, while scope-policy enforcement is a separate tool-runner path that returns immediately when scopePolicy is absent. The fixed local-write effect also cannot represent network or other effects performed by the child.

Evidence:

Evidence 1:



path: src/core/workflow/steps/step-executor-agent-attempt.ts

line: 117

excerpt:



> withHandoffAgentRuntime receives cwd, harness, delegateBudget, canUseTool, askOwner, and tokenBudget, but not agentConfig.scopePolicy or authority identity.

Evidence 2:



path: src/core/tools/handoff-agent.ts

line: 170

excerpt:



> The child run passes autonomyMode and routeKotaToolControlOptions containing allowedTools, disallowedTools, and canUseTool; no scopePolicy is included.

Evidence 3:



path: src/core/tools/tool-runner-scope-policy.ts

line: 25

excerpt:



> const policy = options.scopePolicy;
> if (!policy) return null;

Evidence 4:



path: src/core/tools/handoff-agent.ts

line: 293

excerpt:



> registration declares handoff_agent as effect: localWriteEffect(), regardless of the child's requested tools or external effects.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/core/tools/index.test.ts src/core/tools/guardrails.test.ts src/core/tools/handoff-agent.test.ts src/core/tools/handoff-agent-nested-autonomy.test.ts src/core/tools/handoff-agent-scope-policy.test.ts src/core/tools/handoff-agent-effect-policy.test.ts src/modules/git/index.test.ts src/modules/execution/scope-policy-effects.test.ts src/named-agent-handoff.integration.test.ts` — passed 9 files / 117 tests covering inherited write, network, module, authority, approval, scope identity, transitive immediate-parent autonomy caps, aggregate effects including rejected and externally destructive empty allowlists, dynamically escalating Git effects, real execution-tool registration envelopes, registry risk resolution, and registration isolation.
- A broader affected-runtime suite passed 14 files / 130 tests, including handoff input/runtime, tool permission, guardrail, live scope-policy, workflow, and inbound-signal coverage.
- The three files cited by the severe source-size check remain within the guideline at 284, 297, and 300 lines; the co-located source-size check/escalation suite passed 2 files / 12 tests.
- `pnpm test src/strict-types-policy.integration.test.ts` — passed 1 file / 1 test.
- `pnpm typecheck` — passed.
