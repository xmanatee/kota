---
id: task-security-review-the-stale-skipped-approval-gate-su
title: Security review: The stale skipped approval-gate suppressor trusts control-coverage artifact evidenceRefs and validates them with only a string prefix plus .json suffix before reading them through path.join. A forged or corrupted run artifact can include ../ segments under the accepted prefix, make the audit read unrelated JSON with status skipped, and suppress approval-or-owner-gate-unresolved gaps from autonomy health review.
status: done
priority: p2
area: security
summary: The stale skipped approval-gate suppressor trusts control-coverage artifact evidenceRefs and validates them with only a string prefix plus .json suffix before reading them through path.join. A forged or corrupted run artifact can include ../ segments under the accepted prefix, make the audit read unrelated JSON with status skipped, and suppress approval-or-owner-gate-unresolved gaps from autonomy health review.
created_at: 2026-06-24T17:01:17.007Z
updated_at: 2026-06-24T17:18:18.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.ts
claim:

> The stale skipped approval-gate suppressor trusts control-coverage artifact evidenceRefs and validates them with only a string prefix plus .json suffix before reading them through path.join. A forged or corrupted run artifact can include ../ segments under the accepted prefix, make the audit read unrelated JSON with status skipped, and suppress approval-or-owner-gate-unresolved gaps from autonomy health review.

## Desired Outcome

> Resolve each evidence ref against the exact current run steps directory, reject dot-segments and paths escaping that directory, and only suppress approval-owner gate gaps when the referenced step artifact belongs to the same run and corresponds to an actual skipped approval or owner-wait step from trusted run metadata.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-24T15-19-25-166Z-security-review-vaezko.

finding id: security-review-approval-gap-ref-traversal
candidate id: auth-approval-boundary:src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.ts:164
verdict: confirmed
rationale:

> Confirmed. The code accepts an evidenceRef using only raw prefix and .json suffix checks, then reads it with path.join(ctx.projectDir, ref). Dot segments are not rejected, so a ref under `.kota/runs/<run>/steps/../../...` passes validation while resolving outside the current run steps directory. The suppressor then trusts only `status === "skipped"` and does not verify the step belongs to the same run metadata before skipping the gap.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.ts

line: 50

excerpt:



> return readOptionalJsonFile<ControlMonitorCoverageArtifact>(join(ctx.projectDir, ".kota", "runs", run.id, CONTROL_MONITOR_COVERAGE_ARTIFACT));

Evidence 2:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.ts

line: 152

excerpt:



> function stepEvidenceRefForRun(run: WorkflowHistoryRunLike, ref: string): string | null {

Evidence 3:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.ts

line: 155

excerpt:



> return path.startsWith(prefix) && path.endsWith(".json") ? path : null;

Evidence 4:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.ts

line: 176

excerpt:



> const step = readOptionalJsonFile<StepEvidence>(join(ctx.projectDir, ref));

Evidence 5:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.ts

line: 196

excerpt:



> if (isStaleSkippedApprovalOwnerGateGap(ctx, run, gap)) continue;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verification commands: `pnpm test src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.test.ts`, `pnpm typecheck`, `pnpm lint`.
