import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
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
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitRequiresDaemonRestart,
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
  type ScopeImprovementCooldownDecision,
  type ScopeImprovementEvidencePacket,
  type ScopeImprovementInputs,
  type ScopeImprovementPreflight,
  type ScopeImprovementRecommendation,
  writeScopeImprovementArtifact,
} from "./scope-improvement.js";
import { writeScopeImprovementState } from "./scope-improvement-state.js";
import { scopeImproverTriggers } from "./triggers.js";

type WorktreeInspection = {
  available: boolean;
  dirty: boolean;
  entries: string[];
  summary: string;
};

const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<WorktreeInspection>(raw, [
      "available",
      "dirty",
      "entries",
      "summary",
    ]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    return {
      available: worktree.available,
      dirty: !worktree.available || worktree.dirty,
      entries: worktree.entries,
      summary: worktree.summary,
    };
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

function hasVisibleActions(actions: ScopeImprovementActionResult): boolean {
  return (
    actions.createdTaskIds.length > 0 ||
    actions.ownerQuestionIds.length > 0 ||
    actions.safeEditPaths.length > 0
  );
}

function zeroActionCooldownReason(
  ctx: Parameters<typeof collectInputs.outputRequired>[0],
): string | null {
  const inputs = collectInputs.outputRequired(ctx);
  if (!inputs.config.enabled || inputs.throttle) return null;
  if (applyRecommendations.output(ctx)) return null;
  const recommendations = recommend.output(ctx)?.recommendations ?? [];
  if (recommendations.length === 0) return "no scope-improvement recommendations";
  if (inspectWorktree.output(ctx)?.dirty !== false) {
    return "worktree was dirty before recommendations could be applied";
  }
  return null;
}

const recordZeroActionCooldown = typedCodeStep<ScopeImprovementCooldownDecision>({
  id: "record-zero-action-cooldown",
  type: "code",
  when: stepSucceeded("recommend-improvements"),
  validate: (raw) =>
    expectStructuredOutput<ScopeImprovementCooldownDecision>(raw, [
      "recorded",
      "reason",
    ]),
  run: (ctx) => {
    const reason = zeroActionCooldownReason(ctx);
    if (!reason) return { recorded: false, reason: null };
    writeScopeImprovementState({
      projectDir: ctx.projectDir,
      inputs: collectInputs.outputRequired(ctx),
      actions: [],
    });
    return { recorded: true, reason };
  },
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
      cooldown: recordZeroActionCooldown.output(ctx) ?? {
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
    recordZeroActionCooldown,
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
      when: stepCommitRequiresDaemonRestart("commit"),
      reason: "scope-improver committed scoped improvement actions",
      requires: ["commit"],
    },
  ],
};

export default scopeImproverWorkflow;
