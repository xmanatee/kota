import { join } from "node:path";
import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import {
  type AutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { createGeneratedWorkQuestionQueue } from "#modules/autonomy/generated-work-owner-question.js";
import type { GeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import {
  finalizeGeneratedWorkProposal,
  type StagedGeneratedWorkProposalResult,
} from "#modules/autonomy/generated-work-transaction.js";
import type { IssueDisposition } from "./issue-disposition.js";

export const IMPROVER_DISPOSITION_ARTIFACT = "improver-disposition.json";
export const IMPROVER_DISPOSITION_PUBLICATION_REQUESTED_EVENT =
  "autonomy.improver.disposition-publication.requested";

export type ImproverDispositionPublicationRequest = {
  publicationKey: string;
  sourceRunId: string;
};

export function improverDispositionPublicationKey(sourceRunId: string): string {
  return `improver-disposition-publication:${sourceRunId}`;
}

export function decodeImproverDispositionPublicationRequest(
  value: object,
): ImproverDispositionPublicationRequest {
  const request = value as Partial<ImproverDispositionPublicationRequest>;
  if (typeof request.sourceRunId !== "string") {
    throw new Error("improver disposition publication request is invalid");
  }
  const sourceRunId = validateWorkflowRunId(
    request.sourceRunId,
    "Improver disposition publication",
  );
  if (
    request.publicationKey !== improverDispositionPublicationKey(sourceRunId)
  ) {
    throw new Error("improver disposition publication request is invalid");
  }
  return { publicationKey: request.publicationKey, sourceRunId };
}

export type AppliedDisposition = {
  issueKey: string;
  semanticRevision: number;
  disposition: IssueDisposition;
  proposal: GeneratedWorkProposal;
  materialized: StagedGeneratedWorkProposalResult;
};

export type ImproverDispositionArtifact = {
  schemaVersion: 1;
  decidedAt: string;
  applied: AppliedDisposition;
};

function decodeArtifact(value: unknown): ImproverDispositionArtifact {
  const artifact = value as Partial<ImproverDispositionArtifact>;
  const applied = artifact.applied as Partial<AppliedDisposition> | undefined;
  if (
    artifact.schemaVersion !== 1 ||
    typeof artifact.decidedAt !== "string" ||
    !applied ||
    typeof applied.issueKey !== "string" ||
    typeof applied.semanticRevision !== "number" ||
    !applied.disposition ||
    !applied.proposal ||
    !applied.materialized
  ) {
    throw new Error("improver disposition artifact is invalid");
  }
  return artifact as ImproverDispositionArtifact;
}

function recordDisposition(
  current: AutonomyIssueProjection,
  artifact: ImproverDispositionArtifact,
  materialized: ReturnType<typeof finalizeGeneratedWorkProposal>,
): AutonomyIssueProjection {
  const { applied, decidedAt } = artifact;
  return recordAutonomyIssueDispositions({
    current,
    updates: [
      {
        issueKey: applied.issueKey,
        kind:
          applied.disposition.action === "create-task"
            ? "task"
            : applied.disposition.action === "ask-owner"
              ? "owner-question"
              : applied.disposition.action === "accept"
                ? "accepted"
                : applied.disposition.action === "duplicate"
                  ? "duplicate"
                  : applied.disposition.action === "no-action"
                    ? "no-action"
                    : "observed",
        decidedAt,
        taskIds: materialized.taskId ? [materialized.taskId] : [],
        ownerQuestionIds: materialized.ownerQuestionId
          ? [materialized.ownerQuestionId]
          : [],
      },
    ],
  });
}

export function publishImproverDisposition(args: {
  scopeRoot: string;
  sourceRunId: string;
  currentProjection: AutonomyIssueProjection;
  ownerQuestionQueue?: OwnerQuestionQueue;
}): { published: boolean; nextProjection: AutonomyIssueProjection } {
  const artifact = readOptionalJsonFile<unknown>(
    join(
      args.scopeRoot,
      ".kota",
      "runs",
      args.sourceRunId,
      IMPROVER_DISPOSITION_ARTIFACT,
    ),
  );
  if (artifact === null) {
    return { published: false, nextProjection: args.currentProjection };
  }
  const decoded = decodeArtifact(artifact);
  const materialized = finalizeGeneratedWorkProposal({
    workspaceRoot: args.scopeRoot,
    ownerQuestionQueue:
      args.ownerQuestionQueue ?? createGeneratedWorkQuestionQueue(args.scopeRoot),
    proposal: decoded.applied.proposal,
    staged: decoded.applied.materialized,
  });
  return {
    published: true,
    nextProjection: recordDisposition(
      args.currentProjection,
      decoded,
      materialized,
    ),
  };
}
