---
id: task-security-review-the-eval-harness-record-agent-step
title: Security review: The eval-harness record-agent-step authoring path accepts raw fixture, run, step, and judge identifiers as filesystem path segments, so malformed CLI input can escape the intended fixtures or .kota/runs directories and read or overwrite files outside those roots.
status: ready
priority: p3
area: security
summary: The eval-harness record-agent-step authoring path accepts raw fixture, run, step, and judge identifiers as filesystem path segments, so malformed CLI input can escape the intended fixtures or .kota/runs directories and read or overwrite files outside those roots.
created_at: 2026-06-24T06:32:18.947Z
updated_at: 2026-06-24T07:47:22.413Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/eval-harness/recorder.ts
claim:

> The eval-harness record-agent-step authoring path accepts raw fixture, run, step, and judge identifiers as filesystem path segments, so malformed CLI input can escape the intended fixtures or .kota/runs directories and read or overwrite files outside those roots.

## Desired Outcome

> Constrain --fixture, --run-id, --step, and --judge to conservative identifier patterns, or resolve and verify all derived paths stay under the intended fixture root and .kota/runs source-run root before reading or writing; add traversal regression tests for agent-step and judge modes.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-24T06-26-17-751Z-security-review-ujjy7q.

finding id: security-review-2026-06-24-eval-recorder-path-traversal
candidate id: task-workflow-mutation:src/modules/eval-harness/recorder.ts:213
verdict: confirmed
rationale:

> Confirmed. The CLI maps --fixture directly with join(fixturesRoot, opts.fixture) (src/modules/eval-harness/cli.ts:484), and the recorder reads source artifacts with sourceRunId/stepId or label joined directly into .kota/runs paths (src/modules/eval-harness/recorder.ts:117, 256-262). It then writes recordingPathForStep(..., stepId/label), which joins the requested id under fixtureDir/recordings with no normalization containment check (src/modules/eval-harness/agent-step-recording.ts:216-220; src/modules/eval-harness/recorder.ts:211-213, 294-296). I found no validation that constrains these values to safe identifiers before the reads or writes, so traversal segments can escape the intended source-run or fixture recording roots.

Evidence:

Evidence 1:



path: src/modules/eval-harness/cli.ts

line: 484

excerpt:



> const fixtureDir = join(fixturesRoot, opts.fixture);

Evidence 2:



path: src/modules/eval-harness/recorder.ts

line: 117

excerpt:



> const path = join(projectDir, ".kota", "runs", sourceRunId, "steps", `${stepId}.json`);

Evidence 3:



path: src/modules/eval-harness/agent-step-recording.ts

line: 220

excerpt:



> return join(recordingsDirForFixture(fixtureDir), `${stepId}.json`);

Evidence 4:



path: src/modules/eval-harness/recorder.ts

line: 256

excerpt:



> const artifactPath = join(

Evidence 5:



path: src/modules/eval-harness/recorder.ts

line: 296

excerpt:



> writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
