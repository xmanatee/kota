---
id: task-security-review-repair-loop-agent-iterations-bypas
title: Security review: Repair-loop agent iterations bypass the initial agent-step security boundaries: they invoke the harness with only generic workflow guards, omit the step-specific createCanUseTool guard, and return without re-running writeScope enforcement. A scoped workflow repair can therefore perform tool actions or mutate files that the initial agent step would reject, and the commit path stages all mutated paths.
status: ready
priority: p1
area: security
summary: Repair-loop agent iterations bypass the initial agent-step security boundaries: they invoke the harness with only generic workflow guards, omit the step-specific createCanUseTool guard, and return without re-running writeScope enforcement. A scoped workflow repair can therefore perform tool actions or mutate files that the initial agent step would reject, and the commit path stages all mutated paths.
created_at: 2026-05-26T04:16:15.493Z
updated_at: 2026-05-26T04:16:15.493Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/workflow/repair-loop.ts
claim: Repair-loop agent iterations bypass the initial agent-step security boundaries: they invoke the harness with only generic workflow guards, omit the step-specific createCanUseTool guard, and return without re-running writeScope enforcement. A scoped workflow repair can therefore perform tool actions or mutate files that the initial agent step would reject, and the commit path stages all mutated paths.

## Desired Outcome

Make repair iterations use the same boundary logic as initial agent steps: compose agentConfig.createCanUseTool with createWorkflowAgentGuards, enforce the scoped agent writeScope over the full initial-plus-repair mutation set before returning, and add regression coverage for trial-tool guards and out-of-scope repair edits.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-26T04-09-25-215Z-security-review-yrxk0m.

finding id: repair-loop-agent-boundary-bypass
candidate id: tool-execution:src/core/workflow/repair-loop.ts:169
verdict: confirmed
rationale: Current source confirms the bypass. The initial agent path composes agentConfig.createCanUseTool with createWorkflowAgentGuards and enforces scoped writeScope before returning. executeStep then calls runAgentRepairLoop after that enforcement. The repair loop invokes runAgentHarness with createWorkflowAgentGuards only and its wrap function returns without running findWriteScopeViolations, while commitWorkflowChanges later stages the full mutated path set.

Evidence:

- src/core/workflow/steps/step-executor-agent.ts:208 - const trialCanUseTool = agentConfig.createCanUseTool?.(step.id);
- src/core/workflow/steps/step-executor-agent.ts:349 - if (scopedAgent) {
- src/core/workflow/repair-loop.ts:169 - ...routeKotaToolControlOptions(harness, {
- src/core/workflow/repair-loop.ts:172 - canUseTool: createWorkflowAgentGuards(),
- src/core/workflow/repair-loop.ts:294 - const wrap = (output: Record<string, unknown>): AgentStepResult => {
- src/modules/autonomy/commit.ts:127 - const mutatedPaths = listWorkflowMutatedPaths(projectDir);
- src/modules/autonomy/workflows/explorer/workflow.ts:50 - writeScope: ["data/tasks/", "data/watchlist.yaml"],
- src/modules/autonomy/workflows/explorer/workflow.ts:212 - repairLoop: {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
