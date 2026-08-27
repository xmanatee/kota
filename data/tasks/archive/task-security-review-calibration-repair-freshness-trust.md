---
status: done
---

# Security review: Calibration repair freshness trusts an evaluator-calibration.json placed in any run directory without binding it to trusted run metadata, the builder workflow, or a runtime-authored calibration step. An agent permitted to write run artifacts can forge a descendant sourceRevision and make a closed calibration repair task eligible for recreation.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/calibration-repair-freshness.ts
claim:

> Calibration repair freshness trusts an evaluator-calibration.json placed in any run directory without binding it to trusted run metadata, the builder workflow, or a runtime-authored calibration step. An agent permitted to write run artifacts can forge a descendant sourceRevision and make a closed calibration repair task eligible for recreation.

## Desired Outcome

> Resolve candidate artifacts through trusted run metadata and require a strict binding among directory name, metadata.id, artifact.runId, workflow=builder, terminal status, and the expected runtime-authored calibration step. Reject symlinked entries and malformed artifacts, and base freshness on the bound run summary or step output rather than arbitrary files named evaluator-calibration.json.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-13T18-10-36-599Z-security-review-grfsie.

finding id: security-calibration-freshness-unbound-run-artifact
candidate id: tool-execution:src/modules/autonomy/calibration-repair-freshness.ts:1
verdict: confirmed
rationale:

> inspectCalibrationRepairFreshness accepts evaluator-calibration.json from any .kota/runs child using only sourceRevision syntax, taskId, and Git ancestry. It does not validate metadata.json, directory/runId agreement, workflow identity, terminal status, or producing step. Agents can write within .kota/runs/, and the focused test confirms that a metadata-less artifact is accepted as descendant evidence. When the calibration gate fires, proposeCalibrationRepair trusts that result to recreate a closed repair task.

Evidence:

Evidence 1:

path: src/modules/autonomy/calibration-repair-freshness.ts

line: 78

excerpt:

> for (const entry of readdirSync(runsDir).sort().reverse()) { ... artifact = readOptionalJsonFile<EvaluatorCalibrationArtifact>(join(runsDir, entry, EVALUATOR_CALIBRATION_ARTIFACT));

Evidence 2:

path: src/modules/autonomy/calibration-repair-freshness.ts

line: 88

excerpt:

> The reader validates only sourceRevision's hash shape and ancestry, then returns descendant-observed with artifact.runId; it does not verify the directory's metadata.json, workflow, terminal status, or producing step.

Evidence 3:

path: src/modules/autonomy/workflows/security-review/workflow.ts

line: 46

excerpt:

> The security-reviewer is an untrusted agent step with writeScope: [".kota/runs/"], demonstrating that agent-authored files can occupy the namespace scanned as calibration evidence.

Evidence 4:

path: src/modules/autonomy/calibration-repair.ts

line: 130

excerpt:

> proposeCalibrationRepair consumes inspectCalibrationRepairFreshness and returns action: "recreate" whenever its status is descendant-observed.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
