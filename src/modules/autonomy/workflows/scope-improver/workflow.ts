import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import { taskQueueValidationOperation } from "#modules/repo-tasks/task-queue-validation-operation.js";
import {
  collectInputs,
  discoverCandidates,
  gatherEvidence,
  inspectWorktree,
  recommend,
} from "./preparation-steps.js";
import {
  applyScopeImprovementRecommendationsOperation,
  type ScopeImprovementActionResult,
  type ScopeImprovementArtifact,
  type ScopeImprovementPreflight,
  writeScopeImprovementArtifact,
} from "./scope-improvement.js";
import { decideScopeImprovementConsumption } from "./scope-improvement-consumption.js";
import {
  SCOPE_IMPROVEMENT_PUBLICATION_REQUESTED_EVENT,
  scopeImprovementPublicationKey,
} from "./scope-improvement-publication.js";
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
    ctx.runBlocking(applyScopeImprovementRecommendationsOperation, {
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
    const inputs = collectInputs.outputRequired(ctx);
    const recommendations = recommend.output(ctx)?.recommendations ?? [];
    const actions = applyRecommendations.output(ctx) ?? emptyActions();
    const artifact: ScopeImprovementArtifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      preflight: scopeImproverPreflight(ctx),
      inputs,
      evidence: gatherEvidence.outputRequired(ctx),
      recommendations,
      actions,
      consumption: decideScopeImprovementConsumption({
        inputs,
        recommendationCount: recommendations.length,
        worktreeClean: inspectWorktree.output(ctx)?.dirty === false,
        actionApplied: applyRecommendations.output(ctx) !== undefined,
      }),
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

const validateChanges = typedCodeStep<{ ok: true }>({
  id: "validate-changes",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: async (ctx) => {
    await ctx.runBlocking(taskQueueValidationOperation, {
      projectDir: ctx.projectDir,
      options: { minReady: 0 },
    });
    await ctx.runCommand({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: ctx.projectDir,
    });
    return { ok: true } as const;
  },
});

const scopeImproverWorkflow: WorkflowDefinitionInput = {
  name: "scope-improver",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description:
    "Review explicit onboarding and material scope-policy/content changes, then propose normal tasks or owner questions.",
  tags: ["scope-improvement"],
  triggerAdmission: admitScopeImprovementTrigger,
  triggers: scopeImproverTriggers,
  steps: [
    inspectWorktree,
    collectInputs,
    discoverCandidates,
    gatherEvidence,
    recommend,
    applyRecommendations,
    writeArtifact,
    writeCommitMessage,
    validateChanges,
    {
      id: "emit-scope-improvement-publication",
      type: "emit",
      when: stepSucceeded("write-artifact"),
      event: SCOPE_IMPROVEMENT_PUBLICATION_REQUESTED_EVENT,
      payload: (ctx) => {
        const publicationKey = scopeImprovementPublicationKey(
          ctx.workflow.runId,
        );
        return {
          idempotencyKey: publicationKey,
          publicationKey,
          sourceRunId: ctx.workflow.runId,
        };
      },
    },
  ],
};

export default scopeImproverWorkflow;
