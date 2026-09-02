/**
 * Live-run evaluator calibration monitor.
 *
 * Aggregates production calibration outcomes after successful builder runs and
 * publishes drift as evidence. It deliberately does not manufacture repair
 * work: repeated warning evidence is grouped and dispositioned by the autonomy
 * health reviewer and improver.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import { buildEvaluatorCalibrationDriftHealthSignal } from "#modules/autonomy/health-signal-emitters.js";
import {
  type EvaluatorCalibrationInspection,
  inspectEvaluatorCalibrationOperation,
} from "./inspection.js";

const inspectGate = typedCodeStep<EvaluatorCalibrationInspection>({
  id: "evaluate-calibration",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<EvaluatorCalibrationInspection>(raw, [
      "status",
      "reason",
      "driftKinds",
      "criticPromptHash",
      "thresholdRate",
      "minSample",
      "passWithWarningsThresholdRate",
      "passWithWarningsMinSample",
      "aggregate",
    ]),
  run: ({ stateDir, scopeRoot, runBlocking }) =>
    runBlocking(inspectEvaluatorCalibrationOperation, {
      stateDir,
      scopeRoot,
    }),
});

type CalibrationObservationArtifact = {
  runId: string;
  workflow: string;
  triggerEvent: string;
  sourceRunId: string | null;
  criticPromptHash: string;
  status: EvaluatorCalibrationInspection["status"];
  reason: string;
  driftKinds: EvaluatorCalibrationInspection["driftKinds"];
  aggregate: EvaluatorCalibrationInspection["aggregate"];
  thresholdRate: number;
  minSample: number;
  passWithWarningsThresholdRate: number;
  passWithWarningsMinSample: number;
  generatedAt: string;
};

const writeObservation = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-observation",
  type: "code",
  when: (ctx) => inspectGate.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: async (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    const sourceRunId = ctx.trigger.payload.runId;
    const artifact: CalibrationObservationArtifact = {
      runId: ctx.workflow.runId,
      workflow: ctx.workflow.name,
      triggerEvent: ctx.trigger.event,
      sourceRunId: typeof sourceRunId === "string" ? sourceRunId : null,
      criticPromptHash: inspection.criticPromptHash,
      status: inspection.status,
      reason: inspection.reason,
      driftKinds: inspection.driftKinds,
      aggregate: inspection.aggregate,
      thresholdRate: inspection.thresholdRate,
      minSample: inspection.minSample,
      passWithWarningsThresholdRate: inspection.passWithWarningsThresholdRate,
      passWithWarningsMinSample: inspection.passWithWarningsMinSample,
      generatedAt: new Date().toISOString(),
    };
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(
      ctx.workflow.runDirPath,
      "evaluator-calibration-observation.json",
    );
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return { written: true, path: artifactPath };
  },
});

const evaluatorCalibrationMonitor: WorkflowDefinitionInput = {
  name: "evaluator-calibration-monitor",
  repository: "none",
  description:
    "Measure live evaluator calibration after successful builder runs and publish drift evidence for grouped AI disposition.",
  tags: ["monitored"],
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: ["builder"],
        status: ["success", "completed-with-warnings"],
      },
      queueMode: "all",
    },
  ],
  steps: [
    inspectGate,
    writeObservation,
    {
      id: "emit-regression",
      type: "emit",
      when: (ctx) => inspectGate.output(ctx)?.status === "gated",
      event: "evaluator-calibration.regression.detected",
      payload: (ctx) => {
        const inspection = inspectGate.outputRequired(ctx);
        const aggregate = inspection.aggregate;
        return {
          windowStartMs: aggregate.windowStartMs,
          windowEndMs: aggregate.windowEndMs,
          totalRuns: aggregate.totalRuns,
          passVerdictCount: aggregate.byVerdict.pass,
          passContradictionCount: aggregate.passContradictionCount,
          passContradictionRate: aggregate.passContradictionRate,
          passContradictions: aggregate.passContradictions,
          passWithWarningsCount: aggregate.byVerdict.pass_with_warnings,
          passWithWarningsFollowUpCount:
            aggregate.passWithWarningsFollowUpCount,
          passWithWarningsFollowUpRate:
            aggregate.passWithWarningsFollowUpRate,
          thresholdRate: inspection.thresholdRate,
          passWithWarningsThresholdRate:
            inspection.passWithWarningsThresholdRate,
          driftKinds: inspection.driftKinds,
          reason: inspection.reason,
        };
      },
    },
    {
      id: "emit-health-signal",
      type: "emit",
      when: (ctx) => inspectGate.output(ctx)?.status === "gated",
      event: autonomyHealthSignal.name,
      payload: (ctx) => {
        const inspection = inspectGate.outputRequired(ctx);
        return buildEvaluatorCalibrationDriftHealthSignal({
          runDir: ctx.workflow.runDir,
          driftKinds: inspection.driftKinds,
          decisionReason: inspection.reason,
          contradictions: inspection.aggregate.passContradictions,
          createdAt: new Date().toISOString(),
        });
      },
    },
  ],
};

export default evaluatorCalibrationMonitor;
