import { join } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import { applyScopeImprovementOwnerQuestionEffects } from "./scope-improvement-actions.js";
import {
  completeScopeImprovementInput,
  deferScopeImprovementInput,
} from "./scope-improvement-state.js";
import {
  SCOPE_IMPROVEMENT_ARTIFACT,
  type ScopeImprovementArtifact,
  type ScopeImprovementState,
} from "./scope-improvement-types.js";

export const SCOPE_IMPROVEMENT_PUBLICATION_REQUESTED_EVENT =
  "autonomy.scope-improvement.publication.requested";
export const SCOPE_IMPROVEMENT_PUBLICATION_RESOURCE =
  "autonomy:scope-improvement-publication";

export type ScopeImprovementPublicationRequest = {
  publicationKey: string;
  sourceRunId: string;
};

export type ScopeImprovementPublicationResult = {
  disposition: "absent" | "ignored" | "deferred" | "published";
  nextState: ScopeImprovementState | null;
};

export function scopeImprovementPublicationKey(sourceRunId: string): string {
  return `scope-improvement-publication:${sourceRunId}`;
}

export function decodeScopeImprovementPublicationRequest(
  value: object,
): ScopeImprovementPublicationRequest {
  const request = value as Partial<ScopeImprovementPublicationRequest>;
  if (typeof request.sourceRunId !== "string") {
    throw new Error("scope improvement publication request is invalid");
  }
  const sourceRunId = validateWorkflowRunId(
    request.sourceRunId,
    "Scope improvement publication",
  );
  if (request.publicationKey !== scopeImprovementPublicationKey(sourceRunId)) {
    throw new Error("scope improvement publication request is invalid");
  }
  return { publicationKey: request.publicationKey, sourceRunId };
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

/** Publish canonical effects from a repository:none post-integration workflow. */
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

  const ownerQuestionActions = applyScopeImprovementOwnerQuestionEffects({
    ownerQuestionQueue: new OwnerQuestionQueue(
      join(args.scopeRoot, ".kota", "owner-questions"),
    ),
    runId: args.sourceRunId,
    recommendations: decoded.recommendations,
    repositoryActions: decoded.actions.applied,
  });
  return {
    disposition: "published",
    nextState: completeScopeImprovementInput({
      current: args.currentState,
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
