---
status: dropped
---

# Authenticate calibration freshness through daemon-owned provenance

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/calibration-repair-run-evidence.ts
claim:

> Calibration freshness now checks that metadata.json, the calibration step record, and evaluator-calibration.json agree, but all three remain inside the broadly agent-writable .kota/runs/ tree. File consistency is therefore treated as authenticity: an agent permitted to write run artifacts can still create or replace a mutually consistent builder-shaped bundle and supply a descendant sourceRevision, causing the calibration monitor to accept agent-authored evidence as a runtime-authored successful builder run and recreate the closed repair task.

## Desired Outcome

> Remove the broad .kota/runs/ agent write root. Give the security-reviewer deny-all project scope and rely on the existing run-specific agentOutputDir exception for investigation artifacts. Bind calibration freshness to provenance stored outside every agent-writable root, or authenticate runtime-authored run records independently of their file contents. Add a regression test using the effective harness filesystem roots that proves an artifact-producing agent cannot create or modify sibling run metadata, step records, or calibration artifacts.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-15T22-28-47-494Z-security-review-6xfvq4.

finding id: security-calibration-run-bundle-remains-agent-forgeable
candidate id: tool-execution:src/modules/autonomy/calibration-repair-freshness.ts:1
verdict: confirmed
rationale:

> The security-reviewer declares the full .kota/runs/ tree writable, and the effective native sandbox preserves that root alongside the run-specific agent-output exception. This invocation's filesystem policy likewise exposes the full runs tree for writes. Calibration freshness authenticates no runtime-owned provenance: it accepts metadata.json, the calibration step record, and evaluator-calibration.json when their agent-writable contents agree, then trusts a syntactically valid sourceRevision after only a Git ancestry check. proposeCalibrationRepair treats that result as descendant evidence and may recreate the closed repair task. The consistency and regular-file checks therefore do not prevent an authorized artifact-writing agent from supplying the complete trusted bundle.

Evidence:

Evidence 1:

path: src/modules/autonomy/workflows/security-review/workflow.ts

line: 51

excerpt:

> writeScope: [".kota/runs/"],

Evidence 2:

path: src/core/agent-harness/agent-write-scope-roots.ts

line: 60

excerpt:

> return [...new Set([...declaredRoots, outputRoot])];

Evidence 3:

path: src/core/workflow/steps/step-executor-agent-run-options.ts

line: 115

excerpt:

> ...(agentWriteScope !== undefined ? { agentWriteScope } : {}),

Evidence 4:

path: src/modules/autonomy/calibration-repair-run-evidence.ts

line: 157

excerpt:

> const metadata = readRegularJsonObject(join(runDir, "metadata.json"));

Evidence 5:

path: src/modules/autonomy/calibration-repair-run-evidence.ts

line: 193

excerpt:

> const stepRecord = readRegularJsonObject(join(runDir, "steps", `${EVALUATOR_CALIBRATION_STEP_ID}.json`)); const artifactRecord = readRegularJsonObject(join(runDir, EVALUATOR_CALIBRATION_ARTIFACT));

Evidence 6:

path: src/modules/autonomy/calibration-repair-run-evidence.ts

line: 202

excerpt:

> !isDeepStrictEqual(stepRecord, calibrationStep) || !isDeepStrictEqual(artifactRecord, calibrationStep.output)

Evidence 7:

path: src/modules/autonomy/calibration-repair-freshness.ts

line: 84

excerpt:

> const artifact = readBoundCalibrationArtifact(runsDir, entry.name);

Evidence 8:

path: src/modules/autonomy/calibration-repair-freshness.ts

line: 94

excerpt:

> if (isAncestor(projectDir, repairRevision, sourceRevision)) { return { status: "descendant-observed", repairRevision, runId: artifact.runId, sourceRevision }; }

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Disposition

Dropped because the calibration-repair mechanism was removed. The evaluator
calibration monitor is now observation-only: it writes a run artifact and emits
typed regression and health evidence, but it cannot create, reopen, or promote
a task. The untrusted provenance described here therefore no longer controls a
repository mutation, so the proposed authentication layer would protect an
obsolete authority path.
