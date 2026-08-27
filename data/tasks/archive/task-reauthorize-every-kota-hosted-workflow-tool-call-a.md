---
status: done
---

# Reauthorize every KOTA-hosted workflow tool call against live scope policy

## Problem

    AgentStepConfig and the hosted tool runner retain the scope policy resolved when the step starts. A later restrictive mutation therefore does not affect subsequent KOTA-hosted tool calls in that active step.

## Desired Outcome

    Every KOTA-hosted workflow tool invocation resolves current authority immediately before authorization, so a tool allowed earlier in the step is denied after the governing policy is restricted.

## Constraints

- Use the revisioned authority source from the prerequisite task instead of introducing another resolver or cache.
- Preserve existing effect classification, approval, autonomy, injection-defense, and secret-handling checks.
- Do not weaken the static tool effect or manifest policy when combining it with the latest scope policy.
- Ensure denial prevents the underlying tool implementation and its external effects from running.

## Done When

- Workflow agent configuration passes a live authority accessor to hosted authorization rather than relying on a fixed scopePolicy object.
- The hosted tool authorization boundary resolves the latest policy and revision for every invocation.
- A regression keeps one agent step active, permits its first tool call, changes policy from allow to deny, and proves the next call is denied without invoking the tool.
- Focused coverage includes representative write, module, network, and autonomy restrictions or proves they share the same live boundary.
- The final focused verification command and passing result are recorded in the task.

## Source / Intent

    Fix the interceptable portion of confirmed finding active-workflow-scope-policy-snapshot, including evidence in run-executor.ts, step-executor-agent-run-options.ts, and tool-runner-scope-policy.ts.

Decomposed from `task-security-review-workflow-agent-steps-snapshot-scop` after builder run `2026-08-03T11-27-25-516Z-builder-s4o6v0` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- A controlled active-step regression showing allow, restrictive mutation, then denial of the next identical hosted tool call.
- An assertion that the denied call never reaches the hosted tool implementation.
- A recorded passing focused test command.

## Verification

`TMPDIR="$PWD/.kota/tmp" NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner --silent=true --reporter=dot src/e2e-advanced.test.ts src/core/tools/tool-runner-live-scope-policy.test.ts src/core/agent-harness/tool-execution-options.test.ts src/core/workflow/run-executor-hosted-scope-policy.test.ts src/core/workflow/run-executor-scope-policy.test.ts src/core/workflow/steps/step-context-scope-policy.test.ts src/modules/claude-agent-harness/scope-policy-guard.test.ts src/modules/claude-agent-harness/adapter.test.ts src/core/tools/delegate-turn.test.ts src/core/tools/delegate-runtime-context.test.ts src/core/tools/delegate.test.ts`

Passed after repair attempt 9 on 2026-08-04: the live-policy, direct workflow-context, delegate, Claude adapter, and advanced E2E suite passed 11 files and 46 tests. The direct `ctx.runTool("delegate")` regression permits one child write, restricts the live authority, denies the next identical child call, and proves the child runner executes only once. The advanced E2E fixtures keep real file mutations under the project root so shared guardrails test the intended operation instead of correctly denying an unrelated out-of-project temp path. `node_modules/.bin/tsc --noEmit` and focused Biome also passed.

Passed after repair attempt 11 on 2026-08-04: the same focused suite passed 11 files and 47 tests after `createStepContext` began binding live authority, approval routing, and workflow trace identity around direct KOTA-hosted `ctx.runAgentHarness` calls. The new direct-harness regression keeps one hosted run active across an allow-to-deny revision, confirms the second identical write is denied, and proves its implementation executes only once. `node_modules/.bin/tsc --noEmit` and focused Biome also passed.
