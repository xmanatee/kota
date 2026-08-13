import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import {
  applyCalibrationRepair,
  type CalibrationRepairApplied,
  type CalibrationRepairArtifact,
  type CalibrationRepairProposal,
  proposeCalibrationRepair,
} from "#modules/autonomy/calibration-repair.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  aggregateCalibration,
  type CalibrationDriftKind,
  type EvaluatorCalibrationAggregate,
  evaluateCalibrationGate,
  resolveCalibrationGateConfig,
} from "#modules/autonomy/evaluator-calibration.js";
import { onNormalTrigger } from "#modules/autonomy/recovery.js";

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

export const inspectGate = typedCodeStep<GateInspection>({
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
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    const config = resolveCalibrationGateConfig();
    const aggregate = aggregateCalibration(join(projectDir, ".kota", "runs"), {
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
  },
});

type ProposeResult = { proposal: CalibrationRepairProposal };

export const proposeRepair = typedCodeStep<ProposeResult>({
  id: "propose-repair",
  type: "code",
  when: (ctx) => {
    const inspection = inspectGate.output(ctx);
    return inspection?.status === "gated" && !inspection.dirty;
  },
  validate: (raw) => expectStructuredOutput<ProposeResult>(raw, ["proposal"]),
  run: (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    return {
      proposal: proposeCalibrationRepair({
        projectDir: ctx.projectDir,
        decisionReason: inspection.reason,
        driftKinds: inspection.driftKinds,
        aggregate: inspection.aggregate,
        thresholdRate: inspection.thresholdRate,
        passWithWarningsThresholdRate: inspection.passWithWarningsThresholdRate,
        nowIso: new Date().toISOString(),
      }),
    };
  },
});

type ApplyResult = { applied: CalibrationRepairApplied };

export const applyRepair = typedCodeStep<ApplyResult>({
  id: "apply-repair",
  type: "code",
  when: (ctx) => proposeRepair.output(ctx) !== undefined,
  validate: (raw) => expectStructuredOutput<ApplyResult>(raw, ["applied"]),
  run: (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    return {
      applied: applyCalibrationRepair(proposeRepair.outputRequired(ctx).proposal, {
        projectDir: ctx.projectDir,
        decisionReason: inspection.reason,
        driftKinds: inspection.driftKinds,
        aggregate: inspection.aggregate,
        thresholdRate: inspection.thresholdRate,
        passWithWarningsThresholdRate: inspection.passWithWarningsThresholdRate,
        nowIso: new Date().toISOString(),
      }),
    };
  },
});

export const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: (ctx) => inspectGate.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, ["written", "path"]),
  run: (ctx) => {
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
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(ctx.workflow.runDirPath, "calibration-repair.json");
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return { written: true, path: artifactPath };
  },
});

export const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => {
    const applied = applyRepair.output(ctx)?.applied;
    return applied !== undefined && applied.kind !== "noop";
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
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
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
