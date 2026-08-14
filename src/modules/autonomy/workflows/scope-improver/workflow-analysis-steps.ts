import { repoWorktreeStatusOperation } from "#core/util/repo-worktree-operation.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import { onNormalTrigger } from "#modules/autonomy/recovery.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import {
  applyScopeImprovementRecommendationsOperation,
  collectScopeImprovementInputsOperation,
  discoverScopeImprovementCandidates,
  gatherScopeImprovementEvidence,
  recommendScopeImprovements,
  type ScopeImprovementActionResult,
  type ScopeImprovementCandidate,
  type ScopeImprovementEvidencePacket,
  type ScopeImprovementInputs,
  type ScopeImprovementRecommendation,
} from "./scope-improvement.js";

type WorktreeInspection = {
  available: boolean;
  dirty: boolean;
  entries: string[];
  summary: string;
};

export const inspectWorktree = typedCodeStep<WorktreeInspection>({
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
  run: async ({ projectDir, runBlocking }) => {
    const worktree = await runBlocking(repoWorktreeStatusOperation, {
      projectDir,
    });
    return {
      available: worktree.available,
      dirty: !worktree.available || worktree.dirty,
      entries: worktree.entries,
      summary: worktree.summary,
    };
  },
});

export const collectInputs = typedCodeStep<ScopeImprovementInputs>({
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
  run: ({ projectDir, trigger, runBlocking }) =>
    runBlocking(collectScopeImprovementInputsOperation, {
      projectDir,
      trigger,
      nowIso: new Date().toISOString(),
    }),
});

export const discoverCandidates = typedCodeStep<{
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

export const gatherEvidence = typedCodeStep<ScopeImprovementEvidencePacket>({
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
  run: (ctx) => gatherScopeImprovementEvidence({
    inputs: collectInputs.outputRequired(ctx),
    candidates: discoverCandidates.outputRequired(ctx).candidates,
  }),
});

export const recommend = typedCodeStep<{
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

export const applyRecommendations = typedCodeStep<ScopeImprovementActionResult>({
  id: "apply-recommendations",
  type: "code",
  when: (ctx) => stepSucceeded("recommend-improvements")(ctx) &&
    inspectWorktree.output(ctx)?.dirty === false &&
    recommend.outputRequired(ctx).recommendations.length > 0,
  validate: (raw) =>
    expectStructuredOutput<ScopeImprovementActionResult>(raw, [
      "createdTaskIds",
      "ownerQuestionIds",
      "safeEditPaths",
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
