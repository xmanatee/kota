import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
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
    return recommend.outputRequired(ctx).recommendations.length > 0;
  },
  validate: (raw) =>
    expectStructuredOutput<ScopeImprovementActionResult>(raw, [
      "createdTaskIds",
      "ownerQuestionIds",
      "applied",
      "requiresCommit",
      "parkedReason",
    ]),
  run: async (ctx) => {
    const inputs = collectInputs.outputRequired(ctx);
    const recommendations = recommend.outputRequired(ctx).recommendations;
    if (inputs.config.posture === "observe") {
      return ctx.runBlocking(applyScopeImprovementRecommendationsOperation, {
        workspaceRoot: ctx.scopeRoot,
        runId: ctx.workflow.runId,
        inputs,
        recommendations,
      });
    }
    if (inputs.taskProposalAuthority.outcome !== "allow") {
      return {
        ...emptyActions(),
        parkedReason:
          inputs.taskProposalAuthority.outcome === "confirm"
            ? `scope-improvement actions are parked because the current scope policy requires ` +
              `owner confirmation for task-queue writes: ${inputs.taskProposalAuthority.reason}`
            : `scope-improvement actions are parked because the current scope policy denies ` +
              `task-queue writes: ${inputs.taskProposalAuthority.reason}`,
      };
    }
    const result = await ctx.triggerWorkflow(
      "scope-improvement-actions",
      { sourceRunId: ctx.workflow.runId, inputs, recommendations },
      "completed",
      undefined,
      "apply-recommendations",
    ) as {
      status: "queued" | "completed" | "failed";
      childOutput?: unknown;
    };
    if (result.status !== "completed") {
      throw new Error("scope-improvement task actions did not complete");
    }
    return expectStructuredOutput<ScopeImprovementActionResult>(
      result.childOutput,
      [
        "createdTaskIds",
        "ownerQuestionIds",
        "applied",
        "requiresCommit",
        "parkedReason",
      ],
    );
  },
});

function emptyActions(): ScopeImprovementActionResult {
  return {
    createdTaskIds: [],
    ownerQuestionIds: [],
    applied: [],
    requiresCommit: false,
    parkedReason: null,
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
        parkedReason: actions.parkedReason,
      }),
    };
    return {
      written: true,
      path: writeScopeImprovementArtifact(ctx.workflow.runDirPath, artifact),
    };
  },
});

const scopeImproverWorkflow: WorkflowDefinitionInput = {
  name: "scope-improver",
  repository: "none",
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
