import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import { type ExplorerState, explorerStateAfterCompletion } from "./explorer-state.js";

export const EXPLORER_PUBLICATION_ARTIFACT = "explorer-publication.json";
export const EXPLORER_PUBLICATION_REQUESTED_EVENT =
  "autonomy.explorer.publication.requested";

export type ExplorerPublicationRequest = {
  publicationKey: string;
  sourceRunId: string;
};

export function explorerPublicationKey(sourceRunId: string): string {
  return `explorer-publication:${sourceRunId}`;
}

export function decodeExplorerPublicationRequest(
  value: object,
): ExplorerPublicationRequest {
  const request = value as Partial<ExplorerPublicationRequest>;
  if (typeof request.sourceRunId !== "string") {
    throw new Error("explorer publication request is invalid");
  }
  const sourceRunId = validateWorkflowRunId(
    request.sourceRunId,
    "Explorer publication",
  );
  if (request.publicationKey !== explorerPublicationKey(sourceRunId)) {
    throw new Error("explorer publication request is invalid");
  }
  return { publicationKey: request.publicationKey, sourceRunId };
}

export function publishExplorerCompletion(args: {
  sourceRunId: string;
  scopeRoot: string;
}): ExplorerState | null {
  const artifact = readOptionalJsonFile<{ exploredAt?: unknown }>(
    join(
      args.scopeRoot,
      ".kota",
      "runs",
      args.sourceRunId,
      EXPLORER_PUBLICATION_ARTIFACT,
    ),
  );
  if (artifact === null) return null;
  if (typeof artifact.exploredAt !== "string") {
    throw new Error("explorer publication artifact is invalid");
  }
  return explorerStateAfterCompletion(artifact.exploredAt);
}
