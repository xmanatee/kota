import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowFinalizationContext } from "#core/workflow/types.js";
import { applyScopeImprovementOwnerQuestionEffects } from "./scope-improvement-actions.js";
import {
  canCompleteScopeImprovementInput,
  completeScopeImprovementInput,
  decodeScopeImprovementState,
  deferScopeImprovementInput,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "./scope-improvement-state.js";
import {
  SCOPE_IMPROVEMENT_ARTIFACT,
  type ScopeImprovementArtifact,
  type ScopeImprovementState,
} from "./scope-improvement-types.js";

export type ScopeImprovementPublicationResult = {
  disposition: "absent" | "ignored" | "deferred" | "published";
  nextState: ScopeImprovementState | null;
};

export function finalizeScopeImprovement(ctx: WorkflowFinalizationContext): void {
  const snapshot = ctx.state.read<ScopeImprovementState>(SCOPE_IMPROVEMENT_STATE_KEY);
  const currentState = decodeScopeImprovementState(snapshot.value, ctx.scopeId);
  const result = publishScopeImprovement({ scopeRoot: ctx.scopeRoot, sourceRunId: ctx.runId, currentState });
  if (result.nextState !== null && !isDeepStrictEqual(result.nextState, currentState)) {
    ctx.state.compareAndSet(SCOPE_IMPROVEMENT_STATE_KEY, snapshot.revision, result.nextState);
  }
}

function decodeArtifact(value: unknown): ScopeImprovementArtifact {
  const artifact = value as Partial<ScopeImprovementArtifact>;
  if (
    artifact.schemaVersion !== 1 ||
    typeof artifact.generatedAt !== "string" ||
    !artifact.inputs ||
    !Array.isArray(artifact.recommendations) ||
    !artifact.actions ||
    !Array.isArray(artifact.actions.applied) ||
    !artifact.consumption ||
    (artifact.consumption.disposition !== "consume" &&
      artifact.consumption.disposition !== "defer" &&
      artifact.consumption.disposition !== "ignore")
  ) {
    throw new Error("scope improvement publication artifact is invalid");
  }
  return artifact as ScopeImprovementArtifact;
}

/** Complete idempotent owner effects after the delegated repository work integrates. */
export function publishScopeImprovement(args: {
  scopeRoot: string;
  sourceRunId: string;
  currentState: ScopeImprovementState;
}): ScopeImprovementPublicationResult {
  const artifact = readOptionalJsonFile<unknown>(
    join(
      args.scopeRoot,
      ".kota",
      "runs",
      args.sourceRunId,
      SCOPE_IMPROVEMENT_ARTIFACT,
    ),
  );
  if (artifact === null) return { disposition: "absent", nextState: null };
  const decoded = decodeArtifact(artifact);
  if (decoded.inputs.scope.directoryRoot !== args.scopeRoot) {
    throw new Error("scope improvement artifact does not belong to its runtime scope");
  }
  if (decoded.consumption.disposition === "ignore") {
    return { disposition: "ignored", nextState: null };
  }
  if (decoded.consumption.disposition === "defer") {
    return {
      disposition: "deferred",
      nextState: deferScopeImprovementInput(args.currentState, decoded.inputs),
    };
  }

  const canComplete = canCompleteScopeImprovementInput(
    args.currentState, decoded.inputs, args.sourceRunId,
  );
  const ownerEffectArgs = {
    workspaceRoot: args.scopeRoot,
    ownerQuestionQueue: new OwnerQuestionQueue(
      join(args.scopeRoot, ".kota", "owner-questions"),
    ),
    runId: args.sourceRunId,
    repositoryActions: decoded.actions.applied,
  };
  const ownerQuestionActions = applyScopeImprovementOwnerQuestionEffects({
    ...ownerEffectArgs,
    recommendations: decoded.recommendations,
    inputs: decoded.inputs,
    currentState: args.currentState,
  });
  if (!canComplete) {
    return { disposition: "published", nextState: args.currentState };
  }
  return {
    disposition: "published",
    nextState: completeScopeImprovementInput({
      current: args.currentState,
      sourceRunId: args.sourceRunId,
      inputs: decoded.inputs,
      actions: [
        ...decoded.actions.applied.filter(
          (action) => action.kind !== "owner-question-pending",
        ),
        ...ownerQuestionActions,
      ],
    }),
  };
}
