---
status: dropped
---

# Security review: Workflow agent steps snapshot scope policy once before launching the harness. Restrictive policy changes made while a step is running therefore do not affect its later tool calls, allowing the active agent to retain revoked write, module, network, or autonomy permissions until the step ends.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/workflow/run-executor.ts
claim:

> Workflow agent steps snapshot scope policy once before launching the harness. Restrictive policy changes made while a step is running therefore do not affect its later tool calls, allowing the active agent to retain revoked write, module, network, or autonomy permissions until the step ends.

## Desired Outcome

> Resolve policy at each KOTA-hosted tool authorization boundary. Include an authority revision and cancel, quarantine, or refresh native/opaque harness execution when a restrictive mutation lands. Add a regression where policy changes from allow to deny during an active step and the next tool call is denied.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-02T12-54-03-665Z-security-review-8h4knx.

finding id: active-workflow-scope-policy-snapshot
candidate id: auth-approval-boundary:src/core/workflow/run-executor-deps.ts:4
verdict: confirmed
rationale:

> The workflow executor resolves policy once when constructing AgentStepConfig. Harness run options, autonomy capping, hosted tool authorization, and the Claude policy guard retain that object for the step lifetime. Policy-only authority mutations neither refresh it nor abort active runs.

Evidence:

Evidence 1:

path: src/core/workflow/run-executor.ts

line: 161

excerpt:

> scopePolicy: deps.resolveScopePolicy?.() resolves policy once while constructing AgentStepConfig.

Evidence 2:

path: src/core/workflow/steps/step-executor-agent-run-options.ts

line: 116

excerpt:

> The fixed agentConfig.scopePolicy determines autonomy mode and is passed unchanged to the harness.

Evidence 3:

path: src/core/tools/tool-runner-scope-policy.ts

line: 24

excerpt:

> Each hosted tool call reads the fixed options.scopePolicy object rather than resolving current authority.

Evidence 4:

path: src/core/loop/loop-send.ts

line: 244

excerpt:

> Interactive sessions, by contrast, resolve current scope policy immediately before each tool batch.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Decomposed

- task-add-revisioned-observable-scope-policy-authority
- task-reauthorize-every-kota-hosted-workflow-tool-call-a
- task-invalidate-active-native-and-opaque-harness-runs-o
