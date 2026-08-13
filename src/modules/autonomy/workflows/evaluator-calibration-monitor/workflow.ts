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

import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  checkCommitStageable,
  commitWorkflowChanges,
} from "#modules/autonomy/commit.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import { buildEvaluatorCalibrationDriftHealthSignal } from "#modules/autonomy/health-signal-emitters.js";
import { onRecoveryTrigger, resetWorktreeForRecovery } from "#modules/autonomy/recovery.js";
import {
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitRequiresDaemonRestart,
} from "#modules/autonomy/shared.js";
import {
  applyRepair,
  inspectGate,
  proposeRepair,
  writeArtifact,
  writeCommitMessage,
} from "./calibration-steps.js";

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
    checkNoScratchArtifacts(ctx.projectDir);
    checkCommitStageable(ctx.projectDir);
    checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir);
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<WorkflowCommitOutcome>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: decodeWorkflowCommitOutcome,
  run: ({ projectDir, workflow }) =>
    commitWorkflowChanges(projectDir, workflow.runDirPath),
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
