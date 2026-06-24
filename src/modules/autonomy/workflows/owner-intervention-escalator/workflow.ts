import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  applyOwnerInterventionEscalation,
  buildOwnerInterventionAttentionDigest,
  detectRecurringOwnerInterventionPatterns,
  type OwnerInterventionEscalationApplied,
  type OwnerInterventionEscalationDetection,
  type OwnerInterventionEscalationProposal,
  proposeOwnerInterventionEscalation,
} from "#modules/autonomy/owner-intervention-escalation.js";
import {
  normalizeOwnerInterventionEscalationConfig,
  ownerInterventionThresholds,
} from "#modules/autonomy/owner-intervention-escalation-types.js";
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

type Inspection = {
  dirty: boolean;
  status: "dirty" | "none" | "patterns-detected";
  detection: OwnerInterventionEscalationDetection;
};

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

function emptyDetection(): OwnerInterventionEscalationDetection {
  const config = normalizeOwnerInterventionEscalationConfig();
  return {
    thresholds: ownerInterventionThresholds(config),
    patterns: [],
    ignoredPatterns: [],
    belowThresholdPatterns: [],
  };
}

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
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    const dirty = worktree.available && worktree.trackedDirty;
    if (dirty) {
      return {
        dirty,
        status: "dirty",
        detection: emptyDetection(),
      };
    }
    const detection = detectRecurringOwnerInterventionPatterns(projectDir);
    return {
      dirty,
      status: detection.patterns.length > 0 ? "patterns-detected" : "none",
      detection,
    };
  },
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
    return {
      proposals: inspection.detection.patterns.map((pattern) =>
        proposeOwnerInterventionEscalation(ctx.projectDir, pattern)
      ),
    };
  },
});

const applyTasks = typedCodeStep<ApplyOutput>({
  id: "apply-tasks",
  type: "code",
  when: (ctx) => proposeTasks.output(ctx) !== undefined,
  validate: (raw) => expectStructuredOutput<ApplyOutput>(raw, ["applied"]),
  run: (ctx) => {
    const proposals = proposeTasks.outputRequired(ctx).proposals;
    return {
      applied: proposals.map((proposal) =>
        applyOwnerInterventionEscalation(proposal, {
          projectDir: ctx.projectDir,
          nowIso: new Date().toISOString(),
        })
      ),
    };
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
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
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
      when: stepCommitted("commit"),
      reason:
        "owner-intervention-escalator committed owner-intervention repair task changes",
      requires: ["commit"],
    },
  ],
};

export default ownerInterventionEscalator;
