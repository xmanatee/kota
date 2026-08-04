---
id: task-security-review-a-kota-hosted-parent-can-launch-an
title: Security review: A KOTA-hosted parent can launch an agent-sdk delegate backed by a native tool-control harness, but the delegate only reads scope policy at launch. Native routing discards the live policy accessor, no parent abort signal is propagated, and no restrictive-policy subscription covers the child. A restrictive authority revision during the delegate run therefore leaves its native loop able to perform further writes or external effects and return stale success.
status: ready
priority: p1
area: security
task_class: Safety
summary: A KOTA-hosted parent can launch an agent-sdk delegate backed by a native tool-control harness, but the delegate only reads scope policy at launch. Native routing discards the live policy accessor, no parent abort signal is propagated, and no restrictive-policy subscription covers the child. A restrictive authority revision during the delegate run therefore leaves its native loop able to perform further writes or external effects and return stale success.
created_at: 2026-08-04T06:45:49.622Z
updated_at: 2026-08-04T06:45:49.622Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/tools/delegate-harness.ts
claim:

> A KOTA-hosted parent can launch an agent-sdk delegate backed by a native tool-control harness, but the delegate only reads scope policy at launch. Native routing discards the live policy accessor, no parent abort signal is propagated, and no restrictive-policy subscription covers the child. A restrictive authority revision during the delegate run therefore leaves its native loop able to perform further writes or external effects and return stale success.

## Desired Outcome

> Propagate the parent tool-call AbortSignal into a child AbortController and attach the canonical restrictive scope-policy subscription to every native delegate, or fail closed before launching a native delegate that cannot host live invalidation. Add a regression with a KOTA-controlled parent and native delegate, restrict policy mid-run, and prove quarantine completes with no later native action or terminal output accepted and no leaked listener.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-04T04-04-56-434Z-security-review-0z9fqt.

finding id: native-delegate-restriction-quarantine-gap
candidate id: tool-execution:src/core/tools/delegate-harness.ts:81
verdict: confirmed
rationale:

> runDelegateHarness snapshots policy and caps autonomy, but routeKotaToolControlOptions drops the policy accessor and canUseTool for native harnesses. It also does not translate the inherited tool-call signal into an abortController. Consequently runAgentHarness does not require or activate native quarantine, and no restrictive-policy subscription covers the delegate. A runtime probe tightened policy during a native delegate and confirmed that no abort controller or policy accessor reached the child, the child was not aborted, and stale success was accepted.

Evidence:

Evidence 1:



path: src/core/tools/delegate-harness.ts

line: 98

excerpt:



> const inheritedToolExecution = getCurrentToolCallExecutionOptions();
> const scopePolicy = inheritedToolExecution?.getScopePolicySnapshot?.().policy
>   ?? inheritedToolExecution?.scopePolicy;
> const autonomyMode = scopePolicy
>   ? capScopeAutonomyMode(inheritedAutonomyMode, scopePolicy)
>   : inheritedAutonomyMode;

Evidence 2:



path: src/core/tools/delegate-harness.ts

line: 120

excerpt:



> ...routeKotaToolControlOptions(harness, {
>   allowedTools,
>   canUseTool: inheritedToolExecution?.canUseTool,
>   scopePolicy,
>   getScopePolicySnapshot: inheritedToolExecution?.getScopePolicySnapshot,
> }),
> ...
> autonomyMode,
> cwd: config.cwd ?? process.cwd(),
> effort: "xhigh",
> tokenBudget: config.tokenBudget

Evidence 3:



path: src/core/agent-harness/runner.ts

line: 157

excerpt:



> if (!shouldRouteKotaToolControl(harness)) return {};
> return options;

Evidence 4:



path: src/core/workflow/steps/step-executor-agent-attempt.ts

line: 88

excerpt:



> if (resolvedHarness.toolControl === "native") {
>   unsubscribeScopePolicy = subscribeAgentScopePolicyRestrictions({
>     ...
>     abortController: attemptAbortController,
>   });
> }

Evidence 5:



path: src/core/agent-harness/runner.ts

line: 256

excerpt:



> const requireNativeQuarantine =
>   harness.toolControl === "native" && options.abortController !== undefined;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
