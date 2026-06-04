---
id: task-security-review-the-progress-review-evidence-colle
title: Security review: The progress-review evidence collector trusts the unvalidated `metadata.id` from a run artifact as the later filesystem path segment for trigger and artifact lookup. A crafted `.kota/runs/<dir>/metadata.json` can set `id` to a `../` path, causing the automatic progress-review step to traverse outside `.kota/runs`; the artifact walker also fully recurses before applying its max-artifact cap, making this a local file-enumeration and denial-of-service risk.
status: done
priority: p2
area: security
summary: The progress-review evidence collector trusts the unvalidated `metadata.id` from a run artifact as the later filesystem path segment for trigger and artifact lookup. A crafted `.kota/runs/<dir>/metadata.json` can set `id` to a `../` path, causing the automatic progress-review step to traverse outside `.kota/runs`; the artifact walker also fully recurses before applying its max-artifact cap, making this a local file-enumeration and denial-of-service risk.
created_at: 2026-06-04T13:02:38.037Z
updated_at: 2026-06-04T13:13:18.129Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/progress-reviewer/progress-review.ts
claim: The progress-review evidence collector trusts the unvalidated `metadata.id` from a run artifact as the later filesystem path segment for trigger and artifact lookup. A crafted `.kota/runs/<dir>/metadata.json` can set `id` to a `../` path, causing the automatic progress-review step to traverse outside `.kota/runs`; the artifact walker also fully recurses before applying its max-artifact cap, making this a local file-enumeration and denial-of-service risk.

## Desired Outcome

Use the enumerated run directory name for filesystem paths, validate that `metadata.id` is a safe run-id basename and matches the directory before exposing it, resolve artifact paths and assert they remain under `<project>/.kota/runs/<runDir>`, and stop recursive artifact traversal once the configured max count/depth is reached.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-04T12-01-16-779Z-security-review-z59v6y.

finding id: security-review-progress-run-id-path-traversal
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/progress-reviewer/progress-review.ts:7
verdict: confirmed
rationale: The collector enumerates run directories but then stores and reuses unvalidated metadata.id as runId. That value is used for trigger lookup and artifact directory construction, and artifact traversal recurses before the max-artifact cap is applied. A local probe with metadata.id='../../../outside-run-root' produced evidence paths outside .kota/runs, confirming local path traversal/file-name enumeration and DoS risk.

Evidence:

- src/modules/autonomy/workflows/progress-reviewer/progress-review.ts:458 - const metadata = readOptionalJsonFile<WorkflowRunMetadata>(
- src/modules/autonomy/workflows/progress-reviewer/progress-review.ts:467 - runId: metadata.id,
- src/modules/autonomy/workflows/progress-reviewer/progress-review.ts:593 - const runDir = join(run.source.projectDir, ".kota", "runs", run.runId);
- src/modules/autonomy/workflows/progress-reviewer/progress-review.ts:568 - const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Focused regression transcript: `.kota/runs/2026-06-04T13-05-27-068Z-builder-ilzvxa/progress-reviewer-test.txt`
- Default test-suite repair transcript: `.kota/runs/2026-06-04T13-05-27-068Z-builder-ilzvxa/full-test-repair.txt`
- Touched-file Biome transcript: `.kota/runs/2026-06-04T13-05-27-068Z-builder-ilzvxa/biome-repair.txt`
- Project typecheck transcript: `.kota/runs/2026-06-04T13-05-27-068Z-builder-ilzvxa/typecheck-repair.txt`
- Task-file validation transcript: `.kota/runs/2026-06-04T13-05-27-068Z-builder-ilzvxa/task-files-repair.txt`
