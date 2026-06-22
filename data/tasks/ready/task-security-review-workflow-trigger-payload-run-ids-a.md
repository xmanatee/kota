---
id: task-security-review-workflow-trigger-payload-run-ids-a
title: Security review: Workflow trigger payload run ids are trusted as filesystem path segments when refreshing linked control-coverage artifacts, allowing a crafted runId/sourceRunId/inputEvents payload with ../ segments to make the runtime read and write control coverage outside the project .kota/runs directory when a metadata.json exists at the resolved path.
status: ready
priority: p2
area: security
summary: Workflow trigger payload run ids are trusted as filesystem path segments when refreshing linked control-coverage artifacts, allowing a crafted runId/sourceRunId/inputEvents payload with ../ segments to make the runtime read and write control coverage outside the project .kota/runs directory when a metadata.json exists at the resolved path.
created_at: 2026-06-22T13:24:39.968Z
updated_at: 2026-06-22T13:24:39.968Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/workflow/active-run-handle.ts
claim:

> Workflow trigger payload run ids are trusted as filesystem path segments when refreshing linked control-coverage artifacts, allowing a crafted runId/sourceRunId/inputEvents payload with ../ segments to make the runtime read and write control coverage outside the project .kota/runs directory when a metadata.json exists at the resolved path.

## Desired Outcome

> Validate all linked run ids with the existing path-safe run-id validator before using them, skip or reject invalid references, and assert the resolved source run path remains under the canonical runs directory before any read/write. Add a regression using a ../../ payload that points at a fixture metadata.json and verify no artifact is written outside .kota/runs.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T13-06-20-128Z-security-review-fcc415.

finding id: security-review-linked-run-id-path-traversal
candidate id: task-workflow-mutation:src/core/workflow/active-run-handle.ts:1
verdict: confirmed
rationale:

> Confirmed. Linked run ids from trigger payload fields are collected without path-safe validation in control-monitor-coverage-readers.ts:77-100, including runId, sourceRunId, and nested inputEvents payloads. active-run-handle.ts:104-115 joins each value directly under projectDir/.kota/runs and then writes coverage for that resolved directory. control-monitor-coverage.ts:221-225 writes the artifact at options.runDirPath, so a ../ segment can redirect the refresh outside .kota/runs when a readable metadata.json exists there. Existing validation in run-io.ts covers generated/queued _runId values, not these linked source ids.

Evidence:

Evidence 1:



path: src/core/workflow/run-store-creation.ts

line: 101

excerpt:



> typeof opts.trigger.payload.runId === "string"

Evidence 2:



path: src/core/workflow/control-monitor-coverage-readers.ts

line: 85

excerpt:



> add(triggerPayloadString(payload.runId));

Evidence 3:



path: src/core/workflow/active-run-handle.ts

line: 106

excerpt:



> const sourceRunDirPath = join(projectDir, ".kota", "runs", sourceRunId);

Evidence 4:



path: src/core/workflow/control-monitor-coverage.ts

line: 225

excerpt:



> writeJsonFile(join(options.runDirPath, CONTROL_MONITOR_COVERAGE_ARTIFACT), artifact);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
