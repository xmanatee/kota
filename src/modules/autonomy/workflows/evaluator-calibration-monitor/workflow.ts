/**
 * Live-run evaluator calibration monitor.
 *
 * After each builder run commits, this workflow aggregates calibration
 * artifacts across the rolling window and — when either drift kind crosses
 * its configured threshold — produces a deterministic corrective action
 * against the repo-tasks queue and emits the typed
 * `evaluator-calibration.regression.detected` event so the notify bridge can
 * still surface it through the attention digest.
 *
 * The corrective action is one of: leave the in-flight repair task alone,
 * create a new one in `ready/`, recreate one that previously closed, or
 * promote one that was sitting in `backlog/`. Without this corrective path
 * the monitor was notification-only — it kept reporting drift but the queue
 * never got a concrete next action. The autonomy contract explicitly forbids
 * leaving systemic drift as a "remember this later" attention loop.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  applyCalibrationRepair,
  type CalibrationRepairApplied,
  type CalibrationRepairArtifact,
  type CalibrationRepairProposal,
  proposeCalibrationRepair,
} from "#modules/autonomy/calibration-repair.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  aggregateCalibration,
  type CalibrationDriftKind,
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
  DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
  type EvaluatorCalibrationAggregate,
  evaluateCalibrationGate,
} from "#modules/autonomy/evaluator-calibration.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
} from "#modules/autonomy/shared.js";

type GateInspection = {
  dirty: boolean;
  status: "insufficient-sample" | "under-threshold" | "gated";
  reason: string;
  driftKinds: CalibrationDriftKind[];
  thresholdRate: number;
  passWithWarningsThresholdRate: number;
  aggregate: EvaluatorCalibrationAggregate;
};

function readNumberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return raw;
}

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
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    const dirty = worktree.available && worktree.trackedDirty;
    const runsDir = join(projectDir, ".kota", "runs");
    const config = {
      thresholdRate: readNumberEnv(
        "KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE",
        DEFAULT_CALIBRATION_THRESHOLD_RATE,
      ),
      minSample: Math.floor(
        readNumberEnv(
          "KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE",
          DEFAULT_CALIBRATION_MIN_SAMPLE,
        ),
      ),
      passWithWarningsThresholdRate: readNumberEnv(
        "KOTA_EVALUATOR_CALIBRATION_PWW_THRESHOLD_RATE",
        DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
      ),
      passWithWarningsMinSample: Math.floor(
        readNumberEnv(
          "KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE",
          DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
        ),
      ),
    };

    const aggregate = aggregateCalibration(runsDir);
    const decision = evaluateCalibrationGate(aggregate, config);

    return {
      dirty,
      status: decision.status,
      reason: decision.reason,
      driftKinds: decision.status === "gated" ? decision.kinds : [],
      thresholdRate: config.thresholdRate,
      passWithWarningsThresholdRate: config.passWithWarningsThresholdRate,
      aggregate,
    };
  },
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
  run: (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    const proposal = proposeCalibrationRepair({
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
  run: (ctx) => {
    const inspection = inspectGate.outputRequired(ctx);
    const proposal = proposeRepair.outputRequired(ctx).proposal;
    const applied = applyCalibrationRepair(proposal, {
      projectDir: ctx.projectDir,
      decisionReason: inspection.reason,
      driftKinds: inspection.driftKinds,
      aggregate: inspection.aggregate,
      thresholdRate: inspection.thresholdRate,
      passWithWarningsThresholdRate: inspection.passWithWarningsThresholdRate,
      nowIso: new Date().toISOString(),
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
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(ctx.workflow.runDirPath, "calibration-repair.json");
    const artifact: CalibrationRepairArtifact = {
      decisionReason: inspection.reason,
      driftKinds: inspection.driftKinds,
      proposal,
      applied,
      aggregate: inspection.aggregate,
      thresholdRate: inspection.thresholdRate,
      passWithWarningsThresholdRate: inspection.passWithWarningsThresholdRate,
      generatedAt: new Date().toISOString(),
    };
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
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
  run: (ctx) => {
    runCheck("pnpm run validate-tasks", ctx.projectDir);
    checkNoScratchArtifacts(ctx.projectDir);
    checkCommitStageable(ctx.projectDir);
    checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir);
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<{ committed: boolean }>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: (raw) =>
    expectStructuredOutput<{ committed: boolean }>(raw, ["committed"]),
  run: ({ projectDir, workflow }) => {
    const result = commitWorkflowChanges(projectDir, workflow.runDirPath);
    return { committed: Boolean(result.committed) };
  },
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
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
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
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "evaluator-calibration-monitor committed a calibration repair task",
      requires: ["commit"],
    },
  ],
};

export default evaluatorCalibrationMonitor;
