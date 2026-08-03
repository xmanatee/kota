---
id: task-security-review-the-approvalowner-gate-suppressor-
title: Security review: The approval/owner-gate suppressor derives its trusted run directory from metadata.run.id, but workflow-history accepts any string ID without requiring it to match the enumerated run directory or be a safe path segment. A forged or corrupted metadata.json can therefore select another run or use traversal segments, causing unrelated workflow, coverage, and step JSON to be treated as evidence for the current run and suppress approval-owner-gate diagnostics.
status: ready
priority: p2
area: security
task_class: Safety
summary: The approval/owner-gate suppressor derives its trusted run directory from metadata.run.id, but workflow-history accepts any string ID without requiring it to match the enumerated run directory or be a safe path segment. A forged or corrupted metadata.json can therefore select another run or use traversal segments, causing unrelated workflow, coverage, and step JSON to be treated as evidence for the current run and suppress approval-owner-gate diagnostics.
created_at: 2026-08-03T12:06:44.573Z
updated_at: 2026-08-03T12:06:44.573Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage-gates.ts
claim:

> The approval/owner-gate suppressor derives its trusted run directory from metadata.run.id, but workflow-history accepts any string ID without requiring it to match the enumerated run directory or be a safe path segment. A forged or corrupted metadata.json can therefore select another run or use traversal segments, causing unrelated workflow, coverage, and step JSON to be treated as evidence for the current run and suppress approval-owner-gate diagnostics.

## Desired Outcome

> Treat the enumerated run-directory basename as authoritative. Reject metadata unless metadata.id exactly equals that basename and is one canonical segment with no separators or dot segments. Carry the validated directory identity into all workflow, coverage, and step-artifact readers, and add regressions for mismatched IDs, alternate-run IDs, and traversal IDs.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-03T11-27-25-556Z-security-review-19ktkc.

finding id: security-review-unvalidated-run-id-trust-root
candidate id: auth-approval-boundary:src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage-gates.ts:29
verdict: confirmed
rationale:

> listStoredWorkflowRuns validates metadata.id only as a string and never compares it with the enumerated directory name. Downstream audit readers construct workflow, coverage, error, and step paths from run.id. The step-reference containment check is relative to that same unvalidated path, so it does not establish the authentic run directory. A mismatched, nested, or traversal ID can therefore substitute unrelated artifacts and compromise approval-owner-gate diagnostic integrity.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage-gates.ts

line: 54

excerpt:



> const stepsDir = resolve(ctx.projectDir, ".kota", "runs", run.id, "steps");

Evidence 2:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage-gates.ts

line: 75

excerpt:



> const snapshot = readJsonObject(join(ctx.projectDir, ".kota", "runs", run.id, "workflow.json"));

Evidence 3:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.ts

line: 49

excerpt:



> join(ctx.projectDir, ".kota", "runs", run.id, CONTROL_MONITOR_COVERAGE_ARTIFACT),

Evidence 4:



path: src/modules/workflow-ops/runs/workflow-history.ts

line: 37

excerpt:



> typeof value.id === "string" &&

Evidence 5:



path: src/modules/workflow-ops/runs/workflow-history.ts

line: 77

excerpt:



> runs.push(metadata);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
