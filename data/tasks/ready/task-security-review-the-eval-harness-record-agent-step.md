---
id: task-security-review-the-eval-harness-record-agent-step
title: Security review: The eval-harness record-agent-step authoring path accepts raw fixture, run, step, and judge identifiers as filesystem path segments, so malformed CLI input can escape the intended fixtures or .kota/runs directories and read or overwrite files outside those roots.
status: ready
priority: p3
area: security
summary: The eval-harness record-agent-step authoring path accepts raw fixture, run, step, and judge identifiers as filesystem path segments, so malformed CLI input can escape the intended fixtures or .kota/runs directories and read or overwrite files outside those roots.
created_at: 2026-06-24T06:32:18.947Z
updated_at: 2026-06-24T06:32:18.947Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/eval-harness/recorder.ts
claim:

> The eval-harness record-agent-step authoring path accepts raw fixture, run, step, and judge identifiers as filesystem path segments, so malformed CLI input can escape the intended fixtures or .kota/runs directories and read or overwrite files outside those roots.

## Desired Outcome

> Constrain --fixture, --run-id, --step, and --judge to conservative identifier patterns or resolve and verify all derived paths stay under the intended fixture root and .kota/runs source-run root before reading or writing; add traversal regression tests for agent-step and judge modes.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-24T05-03-16-050Z-security-review-43nasb.

finding id: security-review-2026-06-24-eval-recorder-path-traversal
candidate id: task-workflow-mutation:src/modules/eval-harness/recorder.ts:213
verdict: confirmed
rationale:

> The record-agent-step CLI passes raw --run-id, --fixture, --step, and --judge strings into path joins without enforcing safe single path components: cli.ts:482-517 builds fixtureDir from opts.fixture and forwards opts.runId/opts.step/opts.judge, recorder.ts:117 and recorder.ts:155 read source artifacts under .kota/runs/<sourceRunId>, recorder.ts:256-262 reads <label>.json, and agent-step-recording.ts:216-220 writes recordings using stepId/label as the output filename. The module already has safe path helpers in fixture-parse-utils.ts:15-24, but this authoring path does not use them. Scope is low because this is a local developer command, not a daemon or remote operator route.

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

line: 213

excerpt:



> writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");

Evidence 5:



path: src/modules/eval-harness/recorder.ts

line: 256

excerpt:



> const artifactPath = join(

Evidence 6:



path: src/modules/eval-harness/recorder.ts

line: 296

excerpt:



> writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
