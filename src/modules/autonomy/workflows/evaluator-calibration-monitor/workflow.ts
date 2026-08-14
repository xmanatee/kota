import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import type {
  CalibrationRepairApplied,
  CalibrationRepairProposal,
} from "#modules/autonomy/calibration-repair.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import { buildEvaluatorCalibrationDriftHealthSignal } from "#modules/autonomy/health-signal-emitters.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import { runCheck, stepCommitRequiresDaemonRestart } from "#modules/autonomy/shared.js";
import {
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import { writeCalibrationRepairArtifact } from "./artifact.js";
import {
  type EvaluatorCalibrationInspection,
  inspectEvaluatorCalibrationOperation,
} from "./inspection.js";
import {
  applyCalibrationRepairOperation,
  proposeCalibrationRepairOperation,
} from "./repair-operations.js";

type GateInspection = EvaluatorCalibrationInspection;

const inspectGate = typedCodeStep<GateInspection>({
  id: "evaluate-calibration",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<GateInspection>(raw, [
      "dirty",
      "status",
      "reason",
      "driftKinds",
      "thresholdRate",
      "passWithWarningsThresholdRate",
      "aggregate",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectEvaluatorCalibrationOperation, { projectDir }),
});

type ProposeResult = {
  proposal: CalibrationRepairProposal;
};

const proposeRepair = typedCodeStep<ProposeResult>({
  id: "propose-repair",
  type: "code",
  when: (ctx) => {
    const inspection = inspectGate.output(ctx);
    if (!inspection) return false;
    return inspection.status === "gated" && !inspection.dirty;
  },
  validate: (raw) =>
    expectStructuredOutput<ProposeResult>(raw, ["proposal"]),
  run: async (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    const proposal = await ctx.runBlocking(proposeCalibrationRepairOperation, {
      projectDir: ctx.projectDir,
      decisionReason: inspection.reason,
      driftKinds: inspection.driftKinds,
      aggregate: inspection.aggregate,
      thresholdRate: inspection.thresholdRate,
      passWithWarningsThresholdRate: inspection.passWithWarningsThresholdRate,
      nowIso: new Date().toISOString(),
    });
    return { proposal };
  },
});

type ApplyResult = {
  applied: CalibrationRepairApplied;
};

const applyRepair = typedCodeStep<ApplyResult>({
  id: "apply-repair",
  type: "code",
  when: (ctx) => proposeRepair.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<ApplyResult>(raw, ["applied"]),
  run: async (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    const proposal = proposeRepair.outputRequired(ctx).proposal;
    const applied = await ctx.runBlocking(applyCalibrationRepairOperation, {
      proposal,
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
  when: (ctx) => applyRepair.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, ["written", "path"]),
  run: (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    const proposal = proposeRepair.outputRequired(ctx).proposal;
    const applied = applyRepair.outputRequired(ctx).applied;
    const artifactPath = writeCalibrationRepairArtifact({
      runDirPath: ctx.workflow.runDirPath,
      inspection,
      proposal,
      applied,
    });
    return { written: true, path: artifactPath };
  },
});

function actionLandedOnDisk(applied: CalibrationRepairApplied): boolean {
  return applied.kind !== "noop";
}

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => {
    const applied = applyRepair.output(ctx)?.applied;
    return applied !== undefined && actionLandedOnDisk(applied);
  },
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
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
    const lines: string[] = [
      headline,
      "",
      `Calibration gate fired: ${inspection.driftKinds.join(", ")}.`,
      inspection.reason,
    ];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${lines.join("\n")}\n`,
    );
    return { written: true };
  },
});

const validateBeforeCommit = typedCodeStep<{ ok: true }>({
  id: "validate-before-commit",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: async (ctx) => {
    await runCheck("pnpm run validate-tasks", ctx.projectDir, { signal: ctx.signal });
    await ctx.runBlocking(workflowCommitValidationOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
    });
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<WorkflowCommitOutcome>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: decodeWorkflowCommitOutcome,
  run: (ctx) =>
    ctx.runBlocking(workflowCommitOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
    }),
});

const evaluatorCalibrationMonitor: WorkflowDefinitionInput = {
  name: "evaluator-calibration-monitor",
  description:
    "After each builder commit, aggregate evaluator calibration. When the gate fires, open or promote a calibration repair task and emit a typed regression event for the attention bridge.",
  tags: ["monitored"],
  recoveryCapable: true,
  // Code-only workflow — no agent step. defaultAutonomyMode is omitted because
  // the workflow has no agent step to inherit it.
  triggers: [
    { event: "workflow.build.committed" },
    { event: "runtime.recovered" },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "evaluator-calibration-monitor",
        }),
    },
    inspectGate,
    proposeRepair,
    applyRepair,
    writeArtifact,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-regression",
      type: "emit",
      when: (ctx) => {
        const inspection = inspectGate.output(ctx);
        return inspection !== undefined && inspection.status === "gated";
      },
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
          passWithWarningsFollowUpCount: aggregate.passWithWarningsFollowUpCount,
          passWithWarningsFollowUpRate: aggregate.passWithWarningsFollowUpRate,
          thresholdRate: inspection.thresholdRate,
          passWithWarningsThresholdRate: inspection.passWithWarningsThresholdRate,
          driftKinds: inspection.driftKinds,
          repairAction: applied ? applied.kind : "skipped",
          reason: inspection.reason,
        };
      },
    },
    {
      id: "emit-health-signal",
      type: "emit",
      when: (ctx) => {
        const inspection = inspectGate.output(ctx);
        return inspection !== undefined && inspection.status === "gated";
      },
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
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitRequiresDaemonRestart("commit"),
      reason: "evaluator-calibration-monitor committed a calibration repair task",
      requires: ["commit"],
    },
  ],
};

export default evaluatorCalibrationMonitor;
