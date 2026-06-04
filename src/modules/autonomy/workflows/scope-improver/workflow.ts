import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
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
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import {
  applyScopeImprovementRecommendations,
  collectScopeImprovementInputs,
  discoverScopeImprovementCandidates,
  gatherScopeImprovementEvidence,
  recommendScopeImprovements,
  type ScopeImprovementActionResult,
  type ScopeImprovementArtifact,
  type ScopeImprovementCandidate,
  type ScopeImprovementEvidencePacket,
  type ScopeImprovementInputs,
  type ScopeImprovementRecommendation,
  writeScopeImprovementArtifact,
} from "./scope-improvement.js";
import { scopeImproverTriggers } from "./triggers.js";

type WorktreeInspection = {
  dirty: boolean;
};

const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) => expectStructuredOutput<WorktreeInspection>(raw, ["dirty"]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    return { dirty: worktree.available && worktree.trackedDirty };
  },
});

const collectInputs = typedCodeStep<ScopeImprovementInputs>({
  id: "collect-scope-inputs",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<ScopeImprovementInputs>(raw, [
      "generatedAt",
      "triggerKind",
      "triggerEvent",
      "scope",
      "config",
      "state",
      "instructions",
      "changedFiles",
      "evidence",
      "throttle",
    ]),
  run: ({ projectDir, trigger }) =>
    collectScopeImprovementInputs({ projectDir, trigger, now: new Date() }),
});

const discoverCandidates = typedCodeStep<{
  candidates: ScopeImprovementCandidate[];
}>({
  id: "discover-candidates",
  type: "code",
  when: stepSucceeded("collect-scope-inputs"),
  validate: (raw) =>
    expectStructuredOutput<{ candidates: ScopeImprovementCandidate[] }>(raw, [
      "candidates",
    ]),
  run: (ctx) => ({
    candidates: discoverScopeImprovementCandidates(collectInputs.outputRequired(ctx)),
  }),
});

const gatherEvidence = typedCodeStep<ScopeImprovementEvidencePacket>({
  id: "gather-evidence",
  type: "code",
  when: stepSucceeded("discover-candidates"),
  validate: (raw) =>
    expectStructuredOutput<ScopeImprovementEvidencePacket>(raw, [
      "generatedAt",
      "scope",
      "triggerKind",
      "triggerEvent",
      "evidence",
      "candidates",
    ]),
  run: (ctx) =>
    gatherScopeImprovementEvidence({
      inputs: collectInputs.outputRequired(ctx),
      candidates: discoverCandidates.outputRequired(ctx).candidates,
    }),
});

const recommend = typedCodeStep<{
  recommendations: ScopeImprovementRecommendation[];
}>({
  id: "recommend-improvements",
  type: "code",
  when: stepSucceeded("gather-evidence"),
  validate: (raw) =>
    expectStructuredOutput<{ recommendations: ScopeImprovementRecommendation[] }>(
      raw,
      ["recommendations"],
    ),
  run: (ctx) => ({
    recommendations: recommendScopeImprovements({
      inputs: collectInputs.outputRequired(ctx),
      evidence: gatherEvidence.outputRequired(ctx),
    }),
  }),
});

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
      "safeEditPaths",
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

function emptyActions(): ScopeImprovementActionResult {
  return {
    createdTaskIds: [],
    ownerQuestionIds: [],
    safeEditPaths: [],
    applied: [],
    requiresCommit: false,
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
      inputs: collectInputs.outputRequired(ctx),
      evidence: gatherEvidence.outputRequired(ctx),
      recommendations: recommend.output(ctx)?.recommendations ?? [],
      actions: applyRecommendations.output(ctx) ?? emptyActions(),
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
      ...actions.safeEditPaths.map((path) => `- edit ${path}`),
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
  run: (ctx) => {
    assertTaskQueueValid(ctx.projectDir, { minReady: 0 });
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

const scopeImproverWorkflow: WorkflowDefinitionInput = {
  name: "scope-improver",
  description:
    "Watch configured scopes and turn evidence-backed improvement candidates into tasks, owner questions, or bounded safe edits.",
  tags: ["scope-improvement"],
  recoveryCapable: true,
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
    writeArtifact,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-applied",
      type: "emit",
      when: stepSucceeded("write-artifact"),
      event: "workflow.attention.digest",
      payload: (ctx) => {
        const actions = applyRecommendations.output(ctx) ?? emptyActions();
        return {
          items: [
            {
              label: "Scope improvement",
              detail:
                `tasks=${actions.createdTaskIds.length} ` +
                `questions=${actions.ownerQuestionIds.length} edits=${actions.safeEditPaths.length}`,
            },
          ],
          text:
            "Scope improvement run completed.\n" +
            `Tasks: ${actions.createdTaskIds.join(", ") || "none"}\n` +
            `Owner questions: ${actions.ownerQuestionIds.join(", ") || "none"}\n` +
            `Safe edits: ${actions.safeEditPaths.join(", ") || "none"}`,
        };
      },
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "scope-improver committed scoped improvement actions",
      requires: ["commit"],
    },
  ],
};

export default scopeImproverWorkflow;
