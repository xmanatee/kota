---
id: task-security-review-native-workflow-harnesses-intentio
title: Security review: Native workflow harnesses intentionally discard the resolved scope policy and enforce only its autonomy cap. Because scope-policy dimensions are independent, an autonomous Codex step can still receive a workspace-write sandbox when writes.mode is none or path-bounded, and outbound networking remains allowed when externalEffects denies or requires confirmation. Restrictive policy is therefore not applied or rejected at launch.
status: ready
priority: p1
area: security
task_class: Safety
summary: Native workflow harnesses intentionally discard the resolved scope policy and enforce only its autonomy cap. Because scope-policy dimensions are independent, an autonomous Codex step can still receive a workspace-write sandbox when writes.mode is none or path-bounded, and outbound networking remains allowed when externalEffects denies or requires confirmation. Restrictive policy is therefore not applied or rejected at launch.
created_at: 2026-08-04T00:24:52.565Z
updated_at: 2026-08-04T00:24:52.565Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/codex-agent-harness/adapter.ts
claim:

> Native workflow harnesses intentionally discard the resolved scope policy and enforce only its autonomy cap. Because scope-policy dimensions are independent, an autonomous Codex step can still receive a workspace-write sandbox when writes.mode is none or path-bounded, and outbound networking remains allowed when externalEffects denies or requires confirmation. Restrictive policy is therefore not applied or rejected at launch.

## Desired Outcome

> Reject native-harness launches whenever any effective scope-policy dimension cannot be enforced, or compile writes, modules/tools, external effects, and confirmation requirements into a fail-closed native boundary. Add tests using maxMode autonomous with writes none/path restrictions and networkRead/networkWrite deny to prove the native process cannot perform those effects.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-03T22-34-27-866Z-security-review-nx0r95.

finding id: native-harness-strips-resolved-scope-policy
candidate id: auth-approval-boundary:src/modules/codex-agent-harness/adapter.ts:156
verdict: confirmed
rationale:

> routeKotaToolControlOptions deliberately removes scopePolicy for native harnesses, and the existing capability test explicitly expects this. Only autonomy.maxMode is applied; independent write, module, external-effect, and confirmation restrictions are neither compiled into the Codex sandbox nor rejected. An autonomous policy with writes.mode none or denied networking therefore still launches with workspace writes and unrestricted network access.

Evidence:

Evidence 1:



path: src/core/workflow/steps/step-executor-agent-run-options.ts

line: 102

excerpt:



> scopePolicy is supplied only through routeKotaToolControlOptions alongside allowedTools, disallowedTools, and canUseTool.

Evidence 2:



path: src/core/agent-harness/runner.ts

line: 153

excerpt:



> if (!shouldRouteKotaToolControl(harness)) return {};

Evidence 3:



path: src/modules/codex-agent-harness/adapter.ts

line: 191

excerpt:



> codexSandboxMode returns read-only only for passive mode; every other supported mode becomes workspace-write.

Evidence 4:



path: src/modules/codex-agent-harness/adapter.ts

line: 221

excerpt:



> The Codex adapter declares toolControl: "native", causing the resolved policy to be removed before launch.

Evidence 5:



path: src/core/agent-harness/machine-authority-sandbox.ts

line: 69

excerpt:



> The macOS profile begins with (allow default) and constrains filesystem writes to writable roots, but contains no network-policy enforcement.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
