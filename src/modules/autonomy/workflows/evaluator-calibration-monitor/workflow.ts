/**
 * Live-run evaluator calibration monitor.
 *
 * Aggregates calibration artifacts after successful builder completions, materializes a
 * deterministic repair action when drift crosses the active threshold, and
 * emits typed regression and health signals for operators and automation.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import type {
  CalibrationRepairApplied,
  CalibrationRepairArtifact,
  CalibrationRepairProposal,
} from "#modules/autonomy/calibration-repair.js";
import { proposeCalibrationRepair } from "#modules/autonomy/calibration-repair.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import { buildEvaluatorCalibrationDriftHealthSignal } from "#modules/autonomy/health-signal-emitters.js";
import {
  type EvaluatorCalibrationInspection,
  inspectEvaluatorCalibrationOperation,
} from "./inspection.js";
import {
  applyCalibrationRepairOperation,
} from "./repair-operations.js";

type GateInspection = EvaluatorCalibrationInspection;

const inspectGate = typedCodeStep<GateInspection>({
  id: "evaluate-calibration",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<GateInspection>(raw, [
      "dirty",
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
  run: ({ projectDir, stateDir, runBlocking }) =>
    runBlocking(inspectEvaluatorCalibrationOperation, { projectDir, stateDir }),
});

type ProposeResult = { proposal: CalibrationRepairProposal };

const proposeRepair = typedCodeStep<ProposeResult>({
  id: "propose-repair",
  type: "code",
  when: (ctx) => {
    const inspection = inspectGate.output(ctx);
    return inspection?.status === "gated" && !inspection.dirty;
  },
  validate: (raw) =>
    expectStructuredOutput<ProposeResult>(raw, ["proposal"]),
  run: async (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    const proposal = await proposeCalibrationRepair(
      {
        projectDir: ctx.projectDir,
        decisionReason: inspection.reason,
        driftKinds: inspection.driftKinds,
        aggregate: inspection.aggregate,
        thresholdRate: inspection.thresholdRate,
        passWithWarningsThresholdRate:
          inspection.passWithWarningsThresholdRate,
        nowIso: new Date().toISOString(),
      },
      ctx.runCommand,
    );
    return { proposal };
  },
});

type ApplyResult = { applied: CalibrationRepairApplied };

const applyRepair = typedCodeStep<ApplyResult>({
  id: "apply-repair",
  type: "code",
  when: (ctx) => proposeRepair.output(ctx) !== undefined,
  validate: (raw) => expectStructuredOutput<ApplyResult>(raw, ["applied"]),
  run: async (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    const applied = await ctx.runBlocking(applyCalibrationRepairOperation, {
      proposal: proposeRepair.outputRequired(ctx).proposal,
      context: {
        projectDir: ctx.projectDir,
        decisionReason: inspection.reason,
        driftKinds: inspection.driftKinds,
        aggregate: inspection.aggregate,
        thresholdRate: inspection.thresholdRate,
        passWithWarningsThresholdRate:
          inspection.passWithWarningsThresholdRate,
        nowIso: new Date().toISOString(),
      },
    });
    return { applied };
  },
});

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
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
    const artifact: CalibrationRepairArtifact = {
      runId: ctx.workflow.runId,
      workflow: ctx.workflow.name,
      triggerEvent: ctx.trigger.event,
      sourceRunId: typeof sourceRunId === "string" ? sourceRunId : null,
      criticPromptHash: inspection.criticPromptHash,
      gateStatus: inspection.status,
      decisionReason: inspection.reason,
      driftKinds: inspection.driftKinds,
      proposal: proposeRepair.output(ctx)?.proposal ?? null,
      applied: applyRepair.output(ctx)?.applied ?? null,
      aggregate: inspection.aggregate,
      thresholdRate: inspection.thresholdRate,
      minSample: inspection.minSample,
      passWithWarningsThresholdRate: inspection.passWithWarningsThresholdRate,
      passWithWarningsMinSample: inspection.passWithWarningsMinSample,
      generatedAt: new Date().toISOString(),
    };
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(ctx.workflow.runDirPath, "calibration-repair.json");
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return { written: true, path: artifactPath };
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => {
    const applied = applyRepair.output(ctx)?.applied;
    return applied !== undefined && applied.kind !== "noop";
  },
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: async (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    const applied = applyRepair.outputRequired(ctx).applied;
    const headline = (() => {
      switch (applied.kind) {
        case "created":
          return `evaluator-calibration-monitor: open repair task ${applied.taskId}`;
        case "recreated":
          return `evaluator-calibration-monitor: re-open repair task ${applied.taskId} (was ${applied.previousState})`;
        case "promoted":
          return `evaluator-calibration-monitor: promote repair task ${applied.taskId} ${applied.move.fromState} -> ${applied.move.toState}`;
        case "noop":
          throw new Error("write-commit-message ran for a noop applied action");
      }
    })();
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    await writeFile(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${[
        headline,
        "",
        `Calibration gate fired: ${inspection.driftKinds.join(", ")}.`,
        inspection.reason,
      ].join("\n")}\n`,
    );
    return { written: true };
  },
});

const validateChanges = typedCodeStep<{ ok: true }>({
  id: "validate-changes",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) {
      throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    }
    return obj;
  },
  run: async (ctx) => {
    await ctx.runCommand({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: ctx.projectDir,
    });
    return { ok: true } as const;
  },
});

const evaluatorCalibrationMonitor: WorkflowDefinitionInput = {
  name: "evaluator-calibration-monitor",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description:
    "After each successful builder completion, aggregate evaluator calibration. When the gate fires, open or promote a calibration repair task and emit a typed regression event for the attention bridge.",
  tags: ["monitored"],
  triggers: [
    {
      event: "workflow.completed",
      filter: { workflow: ["builder"], status: ["success", "completed-with-warnings"] },
      queueMode: "all",
    },
  ],
  steps: [
    inspectGate,
    proposeRepair,
    applyRepair,
    writeArtifact,
    writeCommitMessage,
    validateChanges,
    {
      id: "emit-regression",
      type: "emit",
      when: (ctx) => inspectGate.output(ctx)?.status === "gated",
      event: "evaluator-calibration.regression.detected",
      payload: (ctx) => {
        const inspection = inspectGate.outputRequired(ctx);
        const applied = applyRepair.output(ctx)?.applied ?? null;
        const aggregate = inspection.aggregate;
        return {
          windowStartMs: aggregate.windowStartMs,
          windowEndMs: aggregate.windowEndMs,
          totalRuns: aggregate.totalRuns,
          passVerdictCount: aggregate.byVerdict.pass,
          passContradictionCount: aggregate.passContradictionCount,
          passContradictionRate: aggregate.passContradictionRate,
          passWithWarningsCount: aggregate.byVerdict.pass_with_warnings,
          passWithWarningsFollowUpCount:
            aggregate.passWithWarningsFollowUpCount,
          passWithWarningsFollowUpRate:
            aggregate.passWithWarningsFollowUpRate,
          thresholdRate: inspection.thresholdRate,
          passWithWarningsThresholdRate:
            inspection.passWithWarningsThresholdRate,
          driftKinds: inspection.driftKinds,
          repairAction: applied ? applied.kind : "skipped",
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
          createdAt: new Date().toISOString(),
        });
      },
    },
  ],
};

export default evaluatorCalibrationMonitor;
