import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { repoWorktreeStatusOperation } from "#core/util/repo-worktree-operation.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import {
  collectScopeImprovementInputsOperation,
  discoverScopeImprovementCandidates,
  gatherScopeImprovementEvidence,
  recommendScopeImprovements,
  type ScopeImprovementCandidate,
  type ScopeImprovementEvidencePacket,
  type ScopeImprovementInputs,
  type ScopeImprovementRecommendation,
} from "./scope-improvement.js";
import {
  decodeScopeImprovementState,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "./scope-improvement-state.js";
import type { ScopeImprovementState } from "./scope-improvement-types.js";

type WorktreeInspection = {
  available: boolean;
  dirty: boolean;
  entries: string[];
  summary: string;
};

export const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<WorktreeInspection>(raw, [
      "available",
      "dirty",
      "entries",
      "summary",
    ]),
  run: async ({ scopeRoot, runBlocking }) => {
    const worktree = await runBlocking(repoWorktreeStatusOperation, {
      workspaceRoot: scopeRoot,
    });
    return {
      available: worktree.available,
      dirty: worktree.available && worktree.dirty,
      entries: worktree.entries,
      summary: worktree.summary,
    };
  },
});

export const collectInputs = typedCodeStep<ScopeImprovementInputs>({
  id: "collect-scope-inputs",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<ScopeImprovementInputs>(raw, [
      "generatedAt",
      "triggerKind",
      "triggerEvent",
      "scope",
      "config",
      "taskProposalAuthority",
      "state",
      "instructions",
      "changedFiles",
      "evidence",
      "semanticInput",
      "alreadyConsumed",
    ]),
  run: ({
    scopeRoot,
    stateDir,
    state,
    trigger,
    runBlocking,
    scopePolicySnapshot,
  }) => {
    if (!scopePolicySnapshot) {
      throw new Error(
        "scope-improver requires an authoritative resolved scope-policy snapshot",
      );
    }
    const snapshot = state.read<ScopeImprovementState>(
      SCOPE_IMPROVEMENT_STATE_KEY,
    );
    return runBlocking(collectScopeImprovementInputsOperation, {
      workspaceRoot: scopeRoot,
      scopeRoot,
      stateDir,
      state: decodeScopeImprovementState(
        snapshot.value,
        deriveDirectoryScopeId(scopeRoot),
      ),
      trigger,
      nowIso: new Date().toISOString(),
      scopePolicySnapshot,
    });
  },
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
  run: (ctx) =>
    gatherScopeImprovementEvidence({
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
