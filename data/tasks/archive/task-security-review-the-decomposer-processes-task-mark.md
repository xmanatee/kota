---
status: done
---

# Security review: The decomposer processes task markdown using autonomous agent steps whose read-only tool declarations are discarded by the shipped native Codex harness. Its empty writeScope is explicitly unrestricted, and the terminal commit includes every mutated path. A prompt-influenced decomposition agent can therefore modify arbitrary repository files and have them committed instead of being limited to returning a plan for deterministic task mutation.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/workflows/decomposer/workflow.ts
claim:

> The decomposer processes task markdown using autonomous agent steps whose read-only tool declarations are discarded by the shipped native Codex harness. Its empty writeScope is explicitly unrestricted, and the terminal commit includes every mutated path. A prompt-influenced decomposition agent can therefore modify arbitrary repository files and have them committed instead of being limited to returning a plan for deterministic task mutation.

## Desired Outcome

> Give decomposition agents an explicit deny-all write policy distinct from unrestricted writeScope, and enforce tool-free/read-only execution for both agent steps on native harnesses. Fail workflow validation when a selected harness cannot honor declared tool restrictions, constrain the final commit to the deterministic task-mutation set, and add a Codex-default regression proving an attempted source edit neither survives nor commits.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-03T18-46-02-385Z-security-review-0pumcq.

finding id: security-review-decomposer-native-tool-policy-commit-bypass
candidate id: tool-execution:src/modules/autonomy/workflows/decomposer/workflow.ts:384
verdict: confirmed
rationale:

> The shipped default preset selects the native Codex harness. For native harnesses, routeKotaToolControlOptions discards the decomposer's allowedTools and disallowedTools, while autonomous Codex runs receive workspace-write access. The decomposer agent's empty writeScope explicitly permits every path, and commitWorkflowChanges uses the all-mutated-paths policy by default. Consequently, repository edits made by either agent step can survive scope enforcement and be committed alongside deterministic task mutations.

Evidence:

Evidence 1:

path: src/modules/autonomy/workflows/decomposer/workflow.ts

line: 196

excerpt:

> taskMarkdown: readFileSync(join(projectDir, task.path), "utf-8"),

Evidence 2:

path: src/modules/autonomy/workflows/decomposer/workflow.ts

line: 352

excerpt:

> defaultAutonomyMode: "autonomous",

Evidence 3:

path: src/modules/autonomy/workflows/decomposer/workflow.ts

line: 384

excerpt:

> allowedTools: ["Read", "LS", "Grep", "Glob"],

Evidence 4:

path: src/core/agent-harness/runner.ts

line: 152

excerpt:

> if (!shouldRouteKotaToolControl(harness)) return {};

Evidence 5:

path: src/modules/autonomy/workflows/decomposer/workflow.ts

line: 49

excerpt:

> writeScope: [],

Evidence 6:

path: src/core/workflow/steps/agent-write-scope.ts

line: 198

excerpt:

> if (scope.length === 0) return true;

Evidence 7:

path: src/modules/autonomy/commit.ts

line: 224

excerpt:

> const mutatedPaths = listCommitMutatedPaths(projectDir, policy);

Evidence 8:

path: src/modules/autonomy/commit.ts

line: 252

excerpt:

> runGitCommitOnlyPaths(projectDir, msgPath, mutatedPaths);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/core/tools/handoff-agent.test.ts src/core/workflow/steps/agent-write-scope.test.ts src/workflow-step-executor-agent.integration.test.ts src/core/workflow/step-validators/validate-agent-step.test.ts src/modules/autonomy/commit.test.ts src/modules/autonomy/workflows/decomposer/workflow.test.ts src/workflow-validation.integration.test.ts` — 177 tests passed. The passive Codex regression restores a pre-dirty source's distinct staged/worktree contents, removes a new source edit, and leaves HEAD unchanged; validation rejects native named-tool restrictions for deny-all, bounded, and unrestricted agents.
- `pnpm test src/core/workflow/repair-loop.test.ts src/core/workflow/repair-loop-workspace.test.ts src/core/workflow/steps/step-executor-agent-trajectory-diagnostics.test.ts src/strict-types-policy.integration.test.ts src/docs-surface.test.ts src/core/loop/instruction-files.test.ts` — 227 tests passed.
- `pnpm run typecheck`, `pnpm run build`, `pnpm run lint`, and isolated-index `pnpm run validate-tasks` completed successfully.
