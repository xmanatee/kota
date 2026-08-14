import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import {
  buildOwnerInterventionAttentionDigest,
  type OwnerInterventionEscalationApplied,
  type OwnerInterventionEscalationDetection,
  type OwnerInterventionEscalationProposal,
} from "#modules/autonomy/owner-intervention-escalation.js";
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
import {
  inspectOwnerInterventionPatternsOperation,
  type OwnerInterventionInspection,
} from "./inspection.js";
import {
  applyOwnerInterventionTasksOperation,
  proposeOwnerInterventionTasksOperation,
} from "./task-operations.js";

type Inspection = OwnerInterventionInspection;

type ProposalOutput = {
  proposals: OwnerInterventionEscalationProposal[];
};

type ApplyOutput = {
  applied: OwnerInterventionEscalationApplied[];
};

export type OwnerInterventionEscalationArtifact = {
  generatedAt: string;
  dirty: boolean;
  status: Inspection["status"];
  detection: OwnerInterventionEscalationDetection;
  proposals: OwnerInterventionEscalationProposal[];
  applied: OwnerInterventionEscalationApplied[];
};

const inspectPatterns = typedCodeStep<Inspection>({
  id: "inspect-patterns",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<Inspection>(raw, [
      "dirty",
      "status",
      "detection",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectOwnerInterventionPatternsOperation, { projectDir }),
});

const proposeTasks = typedCodeStep<ProposalOutput>({
  id: "propose-tasks",
  type: "code",
  when: (ctx) => {
    const inspection = inspectPatterns.output(ctx);
    return Boolean(
      inspection && !inspection.dirty && inspection.detection.patterns.length > 0,
    );
  },
  validate: (raw) => expectStructuredOutput<ProposalOutput>(raw, ["proposals"]),
  run: (ctx) => {
    const inspection = inspectPatterns.outputRequired(ctx);
    return ctx.runBlocking(proposeOwnerInterventionTasksOperation, {
      projectDir: ctx.projectDir,
      patterns: inspection.detection.patterns,
    });
  },
});

const applyTasks = typedCodeStep<ApplyOutput>({
  id: "apply-tasks",
  type: "code",
  when: (ctx) => proposeTasks.output(ctx) !== undefined,
  validate: (raw) => expectStructuredOutput<ApplyOutput>(raw, ["applied"]),
  run: (ctx) => {
    return ctx.runBlocking(applyOwnerInterventionTasksOperation, {
      projectDir: ctx.projectDir,
      proposals: proposeTasks.outputRequired(ctx).proposals,
      nowIso: new Date().toISOString(),
    });
  },
});

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: (ctx) => inspectPatterns.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const inspection = inspectPatterns.outputRequired(ctx);
    const artifact: OwnerInterventionEscalationArtifact = {
      generatedAt: new Date().toISOString(),
      dirty: inspection.dirty,
      status: inspection.status,
      detection: inspection.detection,
      proposals: proposeTasks.output(ctx)?.proposals ?? [],
      applied: applyTasks.output(ctx)?.applied ?? [],
    };
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(
      ctx.workflow.runDirPath,
      "owner-intervention-escalation.json",
    );
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return { written: true, path: artifactPath };
  },
});

function actionLandedOnDisk(applied: OwnerInterventionEscalationApplied): boolean {
  return (
    applied.kind === "created" ||
    applied.kind === "refreshed" ||
    applied.kind === "promoted" ||
    applied.kind === "recreated"
  );
}

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) =>
    (applyTasks.output(ctx)?.applied ?? []).some(actionLandedOnDisk),
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const applied = applyTasks.outputRequired(ctx).applied.filter(actionLandedOnDisk);
    const subjects = applied.map((item) => `${item.kind} ${item.taskId}`);
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const message = [
      `owner-intervention-escalator: ${subjects.join(", ")}`,
      "",
      "Escalated recurring owner-intervention patterns into repair tasks.",
    ].join("\n");
    writeFileSync(join(ctx.workflow.runDirPath, "commit-message.txt"), `${message}\n`);
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

const ownerInterventionEscalator: WorkflowDefinitionInput = {
  name: "owner-intervention-escalator",
  description:
    "Detect recurring owner-question intervention patterns and open or refresh evidence-backed repair tasks.",
  recoveryCapable: true,
  // Code-only workflow: no agent step inherits an autonomy mode.
  triggers: [
    { event: "owner.question.changed" },
    {
      event: "workflow.completed",
      filter: { tags: ["monitored"] },
    },
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
          workflowName: "owner-intervention-escalator",
        }),
    },
    inspectPatterns,
    proposeTasks,
    applyTasks,
    writeArtifact,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-attention",
      type: "emit",
      when: (ctx) => (inspectPatterns.output(ctx)?.detection.patterns.length ?? 0) > 0,
      event: "workflow.attention.digest",
      payload: (ctx) => {
        const inspection = inspectPatterns.outputRequired(ctx);
        const appliedByPattern = new Map(
          (applyTasks.output(ctx)?.applied ?? []).map((applied) => [
            applied.patternFingerprint,
            applied,
          ]),
        );
        return buildOwnerInterventionAttentionDigest(
          inspection.detection.patterns.map((pattern) => {
            const applied = appliedByPattern.get(pattern.fingerprint);
            return {
              kind: pattern.kind,
              dimension: pattern.dimension,
              taskId: pattern.taskId,
              action: applied?.kind ?? "skipped",
              questionCount: pattern.questionCount,
              runIds: pattern.runIds,
            };
          }),
        );
      },
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitRequiresDaemonRestart("commit"),
      reason:
        "owner-intervention-escalator committed owner-intervention repair task changes",
      requires: ["commit"],
    },
  ],
};

export default ownerInterventionEscalator;
