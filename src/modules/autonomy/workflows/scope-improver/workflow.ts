import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitRequiresDaemonRestart,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import {
  collectInputs,
  discoverCandidates,
  gatherEvidence,
  inspectWorktree,
  recommend,
} from "./preparation-steps.js";
import {
  applyScopeImprovementRecommendations,
  type ScopeImprovementActionResult,
  type ScopeImprovementArtifact,
  type ScopeImprovementConsumptionDecision,
  type ScopeImprovementPreflight,
  writeScopeImprovementArtifact,
} from "./scope-improvement.js";
import {
  deferScopeImprovementInput,
  writeScopeImprovementState,
} from "./scope-improvement-state.js";
import { admitScopeImprovementTrigger } from "./semantic-request.js";
import { scopeImproverTriggers } from "./triggers.js";

const applyRecommendations = typedCodeStep<ScopeImprovementActionResult>({
  id: "apply-recommendations",
  type: "code",
  when: (ctx) => {
    if (!stepSucceeded("recommend-improvements")(ctx)) return false;
    if (inspectWorktree.output(ctx)?.dirty !== false) return false;
    return recommend.outputRequired(ctx).recommendations.length > 0;
  },
  validate: (raw) =>
    expectStructuredOutput<ScopeImprovementActionResult>(raw, [
      "createdTaskIds",
      "ownerQuestionIds",
      "applied",
      "requiresCommit",
    ]),
  run: (ctx) =>
    applyScopeImprovementRecommendations({
      projectDir: ctx.projectDir,
      runId: ctx.workflow.runId,
      inputs: collectInputs.outputRequired(ctx),
      recommendations: recommend.outputRequired(ctx).recommendations,
    }),
});

function hasVisibleActions(actions: ScopeImprovementActionResult): boolean {
  return (
    actions.createdTaskIds.length > 0 ||
    actions.ownerQuestionIds.length > 0
  );
}

function zeroActionConsumptionReason(
  ctx: Parameters<typeof collectInputs.outputRequired>[0],
): string | null {
  const inputs = collectInputs.outputRequired(ctx);
  if (!inputs.config.enabled) return null;
  if (applyRecommendations.output(ctx)) return null;
  if (inputs.alreadyConsumed) {
    return "latest automatic scope fingerprint was already consumed";
  }
  const recommendations = recommend.output(ctx)?.recommendations ?? [];
  return recommendations.length === 0
    ? "semantic input produced no scope-improvement recommendations"
    : null;
}

const recordSemanticConsumption = typedCodeStep<ScopeImprovementConsumptionDecision>({
  id: "record-semantic-consumption",
  type: "code",
  when: stepSucceeded("recommend-improvements"),
  validate: (raw) =>
    expectStructuredOutput<ScopeImprovementConsumptionDecision>(raw, [
      "recorded",
      "reason",
    ]),
  run: (ctx) => {
    const inputs = collectInputs.outputRequired(ctx);
    const recommendations = recommend.output(ctx)?.recommendations ?? [];
    if (
      inputs.semanticInput.automatic &&
      !inputs.alreadyConsumed &&
      inspectWorktree.output(ctx)?.dirty !== false &&
      recommendations.length > 0 &&
      !applyRecommendations.output(ctx)
    ) {
      deferScopeImprovementInput(ctx.projectDir, inputs);
      return {
        recorded: false,
        reason: "semantic scope input deferred until the canonical worktree is clean",
      };
    }
    const reason = zeroActionConsumptionReason(ctx);
    if (!reason) return { recorded: false, reason: null };
    writeScopeImprovementState({
      projectDir: ctx.projectDir,
      inputs,
      actions: [],
    });
    return { recorded: true, reason };
  },
});

function emptyActions(): ScopeImprovementActionResult {
  return {
    createdTaskIds: [],
    ownerQuestionIds: [],
    applied: [],
    requiresCommit: false,
  };
}

function scopeImproverPreflight(
  ctx: Parameters<typeof inspectWorktree.outputRequired>[0],
): ScopeImprovementPreflight {
  const worktree = inspectWorktree.outputRequired(ctx);
  return {
    worktree: {
      available: worktree.available,
      dirty: worktree.dirty,
      entries: worktree.entries,
      summary: worktree.summary,
    },
  };
}

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: stepSucceeded("gather-evidence"),
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const artifact: ScopeImprovementArtifact = {
      generatedAt: new Date().toISOString(),
      preflight: scopeImproverPreflight(ctx),
      inputs: collectInputs.outputRequired(ctx),
      evidence: gatherEvidence.outputRequired(ctx),
      recommendations: recommend.output(ctx)?.recommendations ?? [],
      actions: applyRecommendations.output(ctx) ?? emptyActions(),
      consumption: recordSemanticConsumption.output(ctx) ?? {
        recorded: false,
        reason: null,
      },
    };
    return {
      written: true,
      path: writeScopeImprovementArtifact(ctx.workflow.runDirPath, artifact),
    };
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => applyRecommendations.output(ctx)?.requiresCommit === true,
  validate: (raw) => expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const actions = applyRecommendations.outputRequired(ctx);
    const lines = [
      "scope-improver: apply scoped improvement action(s)",
      "",
      ...actions.createdTaskIds.map((id) => `- create ${id}`),
    ];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${lines.join("\n")}\n`,
      "utf-8",
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
    assertTaskQueueValid(ctx.projectDir, { minReady: 0 });
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

const scopeImproverWorkflow: WorkflowDefinitionInput = {
  name: "scope-improver",
  description:
    "Review explicit onboarding and material scope-policy/content changes, then propose normal tasks or owner questions.",
  tags: ["scope-improvement"],
  recoveryCapable: true,
  triggerAdmission: admitScopeImprovementTrigger,
  triggers: scopeImproverTriggers,
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({ projectDir, workflowName: "scope-improver" }),
    },
    inspectWorktree,
    collectInputs,
    discoverCandidates,
    gatherEvidence,
    recommend,
    applyRecommendations,
    recordSemanticConsumption,
    writeArtifact,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-applied",
      type: "emit",
      when: (ctx) => {
        if (!stepSucceeded("write-artifact")(ctx)) return false;
        const actions = applyRecommendations.output(ctx);
        return actions ? hasVisibleActions(actions) : false;
      },
      event: "workflow.attention.digest",
      payload: (ctx) => {
        const actions = applyRecommendations.output(ctx) ?? emptyActions();
        return {
          items: [
            {
              label: "Scope improvement",
              detail:
                `tasks=${actions.createdTaskIds.length} ` +
                `questions=${actions.ownerQuestionIds.length}`,
            },
          ],
          text:
            "Scope improvement run completed.\n" +
            `Tasks: ${actions.createdTaskIds.join(", ") || "none"}\n` +
            `Owner questions: ${actions.ownerQuestionIds.join(", ") || "none"}`,
        };
      },
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitRequiresDaemonRestart("commit"),
      reason: "scope-improver committed scoped improvement actions",
      requires: ["commit"],
    },
  ],
};

export default scopeImproverWorkflow;
