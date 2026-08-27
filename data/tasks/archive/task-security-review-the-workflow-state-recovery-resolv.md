---
status: done
---

# Security review: The workflow state-recovery resolve route accepts artifactRunId as an arbitrary string and the artifact writer uses it directly as a path segment, allowing a control-scoped caller to traverse out of .kota/runs and write workflow-state-recovery.json elsewhere on the filesystem.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflow-state-recovery-artifacts.ts
claim:

> The workflow state-recovery resolve route accepts artifactRunId as an arbitrary string and the artifact writer uses it directly as a path segment, allowing a control-scoped caller to traverse out of .kota/runs and write workflow-state-recovery.json elsewhere on the filesystem.

## Desired Outcome

> Validate artifactRunId with the existing workflow run-id validator before it reaches artifactPath, reject invalid route/CLI input, and add a regression test proving ../ traversal does not write outside .kota/runs.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-08T02-43-09-177Z-security-review-7fb8wh.

finding id: security-review-state-recovery-artifact-run-id-path-traversal
candidate id: external-fetch:src/modules/workflow-ops/state-recovery-routes.ts:88
verdict: confirmed
rationale:

> The POST control route accepts artifactRunId as any string and forwards it into provider.resolve without validation at src/modules/workflow-ops/state-recovery-routes.ts:42 and :116-121. The provider calls finishResolve on noop, refusal, and mutation paths, and finishResolve builds the artifact path from input.artifactRunId with join(projectDir, ".kota", "runs", runId, "workflow-state-recovery.json") at src/modules/autonomy/workflow-state-recovery-artifacts.ts:11-13, then creates directories and writes at :20-21 and :56-61. writeJsonFileAtomic writes to the supplied path without root enforcement at src/core/util/json-file.ts:51-63. The existing validateWorkflowRunId path-safe validator exists at src/core/workflow/run-io.ts:56-75 but is not applied to artifactRunId, so ../ segments can escape .kota/runs.

Evidence:

Evidence 1:

path: src/modules/workflow-ops/state-recovery-routes.ts

line: 40

excerpt:

> ...(typeof body.artifactRunId === "string" ? { artifactRunId: body.artifactRunId } : {}),

Evidence 2:

path: src/modules/workflow-ops/state-recovery-routes.ts

line: 116

excerpt:

> const result = provider.resolve({

Evidence 3:

path: src/modules/autonomy/workflow-state-recovery-artifacts.ts

line: 12

excerpt:

> const runId = input.artifactRunId ?? formatRunId("workflow-state-recovery");

Evidence 4:

path: src/modules/autonomy/workflow-state-recovery-artifacts.ts

line: 13

excerpt:

> return join(input.projectDir, ".kota", "runs", runId, "workflow-state-recovery.json");

Evidence 5:

path: src/core/workflow/run-io.ts

line: 58

excerpt:

> export function validateWorkflowRunId(runId: string, source: string): string {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/autonomy/workflow-state-recovery-actions.test.ts src/modules/workflow-ops/local-client-recovery.test.ts src/modules/workflow-ops/state-recovery-routes.test.ts`
- `pnpm typecheck`
- `pnpm lint`
