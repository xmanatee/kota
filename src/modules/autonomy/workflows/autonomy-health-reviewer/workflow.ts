import { existsSync } from "node:fs";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import {
  type AutonomyHealthJsonObject,
  type AutonomyHealthSignal,
  autonomyHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  type AutonomyHealthReview,
  type AutonomyHealthReviewActionResult,
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthAttentionDigest,
  buildAutonomyHealthReview,
  buildAutonomyHealthReviewFromSignals,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";
import {
  createHealthReviewTaskResolutionSteps,
} from "./health-review-task-resolution.js";
import {
  collectRuntimeHealthAudit,
  type RuntimeHealthAudit,
  writeRuntimeHealthAuditArtifact,
} from "./runtime-health-audit.js";

type WorktreeInspection = {
  dirty: boolean;
};

type AuditOutput = {
  signals: AutonomyHealthSignal[];
  generatedAt: string;
  windowStart: string;
  inspected: RuntimeHealthAudit["inspected"];
  patternCount: number;
  evidenceGapCount: number;
  artifactPath: string;
};

type ReviewOutput = {
  review: AutonomyHealthReview;
};

type ActionOutput = {
  actions: AutonomyHealthReviewActionResult;
};

const AUTONOMY_HEALTH_AUDIT_SCHEDULE_EVENT = "autonomy.runtime-health.audit.scheduled";

export function runtimeHealthAuditStepOutput(
  audit: RuntimeHealthAudit,
  artifactPath: string,
): AuditOutput {
  return {
    signals: audit.signals,
    generatedAt: audit.generatedAt,
    windowStart: audit.windowStart,
    inspected: audit.inspected,
    patternCount: audit.patterns.length,
    evidenceGapCount: audit.evidenceGaps.length,
    artifactPath,
  };
}

const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  validate: (raw) => expectStructuredOutput<WorktreeInspection>(raw, ["dirty"]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    return { dirty: worktree.available && worktree.dirty };
  },
});

function isRuntimeAuditTrigger(event: string): boolean {
  return (
    event === "schedule" ||
    event === AUTONOMY_HEALTH_AUDIT_SCHEDULE_EVENT ||
    event === "runtime.recovered"
  );
}

const buildRuntimeAudit = typedCodeStep<AuditOutput>({
  id: "build-runtime-audit",
  type: "code",
  when: (ctx) => isRuntimeAuditTrigger(ctx.trigger.event),
  validate: (raw) =>
    expectStructuredOutput<AuditOutput>(raw, [
      "signals",
      "artifactPath",
      "patternCount",
      "evidenceGapCount",
    ]),
  run: ({ projectDir, workflow }) => {
    const audit = collectRuntimeHealthAudit({ projectDir });
    const artifactPath = writeRuntimeHealthAuditArtifact(
      workflow.runDirPath,
      audit,
    );
    return runtimeHealthAuditStepOutput(audit, artifactPath);
  },
});

const buildReview = typedCodeStep<ReviewOutput>({
  id: "build-review",
  type: "code",
  when: (ctx) =>
    !isRuntimeAuditTrigger(ctx.trigger.event) ||
    buildRuntimeAudit.output(ctx) !== undefined,
  validate: (raw) => expectStructuredOutput<ReviewOutput>(raw, ["review"]),
  run: (ctx) => {
    const generatedAt = new Date().toISOString();
    const runtimeAudit = buildRuntimeAudit.output(ctx);
    if (runtimeAudit) {
      return {
        review: buildAutonomyHealthReviewFromSignals({
          signals: runtimeAudit.signals,
          generatedAt,
          sourceEventName: "autonomy.runtime-health.audit",
          reason: ctx.trigger.event,
        }),
      };
    }
    return {
      review: buildAutonomyHealthReview({
        triggerPayload: ctx.trigger.payload as AutonomyHealthJsonObject,
        generatedAt,
      }),
    };
  },
});

const applyActions = typedCodeStep<ActionOutput>({
  id: "apply-actions",
  type: "code",
  when: (ctx) =>
    buildReview.output(ctx) !== undefined &&
    inspectWorktree.output(ctx)?.dirty === false,
  validate: (raw) => expectStructuredOutput<ActionOutput>(raw, ["actions"]),
  run: (ctx) => {
    const actions = applyAutonomyHealthReviewActions({
      projectDir: ctx.projectDir,
      review: buildReview.outputRequired(ctx).review,
    });
    for (const action of actions.applied) {
      if (action.kind !== "decision-requested") continue;
      ctx.emit(autonomyIssueDecisionRequested.name, {
        issueKey: action.issueKey,
        rootCauseKey: action.dedupeKey,
        semanticRevision: action.semanticRevision,
        transition: action.transition,
        observedAt: buildReview.outputRequired(ctx).review.generatedAt,
      });
    }
    return { actions };
  },
});

const taskResolution = createHealthReviewTaskResolutionSteps(applyActions);

function emptyActions(): AutonomyHealthReviewActionResult {
  return {
    createdTaskIds: [],
    droppedTaskIds: [],
    ownerQuestionIds: [],
    dismissedOwnerQuestionIds: [],
    taskMutationPaths: [],
    issueTransitions: [],
    applied: [],
    touchedTaskQueue: false,
  };
}

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: async (ctx) =>
    buildReview.output(ctx) !== undefined && await taskResolution.isDurable(ctx),
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const review = buildReview.outputRequired(ctx).review;
    const actions = applyActions.output(ctx)?.actions ?? emptyActions();
    const path = writeAutonomyHealthReviewArtifact(ctx.workflow.runDirPath, {
      generatedAt: new Date().toISOString(),
      review,
      actions,
    });
    return { written: true, path };
  },
});

const writeRuntimeAuditArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-runtime-audit-artifact",
  type: "code",
  when: (ctx) => buildRuntimeAudit.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const path = buildRuntimeAudit.outputRequired(ctx).artifactPath;
    if (!existsSync(path)) {
      throw new Error(`runtime health audit artifact was not written: ${path}`);
    }
    return { written: true, path };
  },
});

const autonomyHealthReviewerWorkflow: WorkflowDefinitionInput = {
  name: "autonomy-health-reviewer",
  description:
    "Project typed autonomy health observations into durable issue transitions and request review only for undecided revisions.",
  recoveryCapable: true,
  triggers: [
    {
      event: AUTONOMY_HEALTH_AUDIT_SCHEDULE_EVENT,
      intervalMs: 6 * 60 * 60 * 1000,
      cooldownMs: 60 * 60 * 1000,
    },
    {
      event: autonomyHealthSignal.name,
      filter: { severity: "critical" },
    },
    {
      event: autonomyHealthSignal.name,
      filter: { severity: ["warning", "error"] },
      batch: {
        maxCount: 5,
        maxAgeMs: 60 * 60 * 1000,
        groupBy: ["scopeId", "labelsKey"],
        maxBufferSize: 20,
        overflow: "flush-oldest",
      },
    },
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
          workflowName: "autonomy-health-reviewer",
        }),
    },
    inspectWorktree,
    buildRuntimeAudit,
    buildReview,
    applyActions,
    ...taskResolution.steps,
    writeArtifact,
    writeRuntimeAuditArtifact,
    {
      id: "emit-attention",
      type: "emit",
      when: async (ctx) =>
        (applyActions.output(ctx)?.actions.applied.length ?? 0) > 0 &&
        await taskResolution.isDurable(ctx),
      event: "workflow.attention.digest",
      payload: (ctx) =>
        buildAutonomyHealthAttentionDigest({
          review: buildReview.outputRequired(ctx).review,
          actions: applyActions.output(ctx)?.actions ?? emptyActions(),
        }),
    },
  ],
};

export default autonomyHealthReviewerWorkflow;
