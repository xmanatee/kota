/**
 * Live-run evaluator calibration monitor.
 *
 * Aggregates calibration artifacts after builder commits, materializes a
 * deterministic repair action when drift crosses the active threshold, and
 * emits typed regression and health signals for operators and automation.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
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
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  aggregateCalibration,
  type CalibrationDriftKind,
  type EvaluatorCalibrationAggregate,
  evaluateCalibrationGate,
  resolveCalibrationGateConfig,
} from "#modules/autonomy/evaluator-calibration.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import { buildEvaluatorCalibrationDriftHealthSignal } from "#modules/autonomy/health-signal-emitters.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  runCheck,
  stepCommitRequiresDaemonRestart,
} from "#modules/autonomy/shared.js";
import {
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  applyCalibrationRepairOperation,
  proposeCalibrationRepairOperation,
} from "./repair-operations.js";

type GateInspection = {
  dirty: boolean;
  status: "insufficient-sample" | "under-threshold" | "gated";
  reason: string;
  driftKinds: CalibrationDriftKind[];
  thresholdRate: number;
  minSample: number;
  passWithWarningsThresholdRate: number;
  passWithWarningsMinSample: number;
  aggregate: EvaluatorCalibrationAggregate;
};

export function inspectEvaluatorCalibrationInWorker(input: {
  projectDir: string;
}): GateInspection {
  const worktree = getRepoWorktreeStatus(input.projectDir);
  const config = resolveCalibrationGateConfig();
  const aggregate = aggregateCalibration(join(input.projectDir, ".kota", "runs"), {
    criticPromptHash: getCriticPromptHash(),
  });
  const decision = evaluateCalibrationGate(aggregate, config);
  return {
    dirty: worktree.available && worktree.dirty,
    status: decision.status,
    reason: decision.reason,
    driftKinds: decision.status === "gated" ? decision.kinds : [],
    thresholdRate: config.thresholdRate,
    minSample: config.minSample,
    passWithWarningsThresholdRate: config.passWithWarningsThresholdRate,
    passWithWarningsMinSample: config.passWithWarningsMinSample,
    aggregate,
  };
}

const inspectEvaluatorCalibrationOperation = defineWorkflowBlockingOperation<
  { projectDir: string },
  GateInspection
>(import.meta.url, "inspectEvaluatorCalibrationInWorker");

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
      "minSample",
      "passWithWarningsThresholdRate",
      "passWithWarningsMinSample",
      "aggregate",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectEvaluatorCalibrationOperation, { projectDir }),
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
      criticPromptHash: getCriticPromptHash(),
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

const validateBeforeCommit = typedCodeStep<{ ok: true }>({
  id: "validate-before-commit",
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
    await runCheck("pnpm run validate-tasks", ctx.projectDir, {
      signal: ctx.signal,
    });
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
