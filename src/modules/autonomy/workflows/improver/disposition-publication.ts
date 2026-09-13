import { join } from "node:path";
import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import type { WorkflowFinalizationContext, WorkflowPostReconcileInvariant } from "#core/workflow/types.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  decodeAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { stageAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection-publication.js";
import {
  autonomyIssueOwnerFingerprint,
} from "#modules/autonomy/autonomy-issue-reconciliation.js";
import { createGeneratedWorkQuestionQueue } from "#modules/autonomy/generated-work-owner-question.js";
import type { GeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import {
  finalizeGeneratedWorkProposal,
  type StagedGeneratedWorkProposalResult,
  verifyGeneratedWorkExistingTask,
} from "#modules/autonomy/generated-work-proposal.js";
import {
  type DeterministicRecoveryResult,
  verifyDeterministicRecovery,
} from "./deterministic-recovery.js";
import type { IssueDisposition } from "./issue-disposition.js";
import { selectIssueForProjection } from "./issue-selection.js";

export const IMPROVER_DISPOSITION_ARTIFACT = "improver-disposition.json";
export function finalizeImproverDisposition(ctx: WorkflowFinalizationContext): void {
  const snapshot = ctx.state.read<AutonomyIssueProjection>(AUTONOMY_ISSUE_PROJECTION_STATE_KEY);
  const current = decodeAutonomyIssueProjection(snapshot.value);
  const publication = publishImproverDisposition({
    scopeRoot: ctx.scopeRoot,
    sourceRunId: ctx.runId,
    currentProjection: current,
  });
  stageAutonomyIssueProjection({
    state: ctx.state,
    key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
    revision: snapshot.revision,
    current,
    next: publication.nextProjection,
  });
}

export type AppliedDisposition = {
  issueKey: string;
  semanticRevision: number;
  ownerFingerprint: string;
  disposition: IssueDisposition;
  proposal: GeneratedWorkProposal;
  materialized: StagedGeneratedWorkProposalResult;
  recovery: DeterministicRecoveryResult | null;
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
    typeof applied.ownerFingerprint !== "string" ||
    !applied.disposition ||
    !applied.proposal ||
    !applied.materialized ||
    !(applied.recovery === null || typeof applied.recovery === "object") ||
    (applied.disposition.action === "recover") !== (applied.recovery !== null)
  ) {
    throw new Error("improver disposition artifact is invalid");
  }
  return artifact as ImproverDispositionArtifact;
}

export function readImproverDispositionArtifact(
  scopeStateDir: string,
  sourceRunId: string,
): ImproverDispositionArtifact | null {
  const artifact = readOptionalJsonFile<unknown>(
    join(
      scopeStateDir,
      "runs",
      validateWorkflowRunId(sourceRunId, "Improver disposition artifact"),
      IMPROVER_DISPOSITION_ARTIFACT,
    ),
  );
  return artifact === null ? null : decodeArtifact(artifact);
}

export function isImproverDispositionCurrent(
  current: AutonomyIssueProjection,
  applied: AppliedDisposition,
): boolean {
  const issue = current.issues.find((candidate) =>
    candidate.issueKey === applied.issueKey &&
    candidate.semanticRevision === applied.semanticRevision
  );
  return issue !== undefined &&
    issue.status !== "resolved" &&
    autonomyIssueOwnerFingerprint(issue) === applied.ownerFingerprint;
}

function recordDisposition(
  current: AutonomyIssueProjection,
  artifact: ImproverDispositionArtifact,
  materialized: ReturnType<typeof finalizeGeneratedWorkProposal>,
  sourceRunId: string,
): AutonomyIssueProjection {
  const { applied, decidedAt } = artifact;
  if (applied.disposition.action === "recover") {
    const issue = current.issues.find((candidate) =>
      candidate.issueKey === applied.issueKey &&
      candidate.semanticRevision === applied.semanticRevision
    );
    if (issue === undefined) return current;
    return applyAutonomyIssueObservations({
      current,
      observations: [buildAutonomyIssueObservation({
        kind: "cleared",
        rootCauseKey: issue.rootCauseKey,
        observedAt: decidedAt,
        signalIds: [`doctor-recovery:${sourceRunId}`],
        source: issue.source,
        severity: issue.severity,
        actionability: issue.actionability,
        labels: issue.labels,
        summaries: [
          `Verified ${applied.recovery!.action} recovery settled the cited runtime condition.`,
        ],
        evidenceRefs: [{
          kind: "artifact",
          ref: `.kota/runs/${sourceRunId}/${IMPROVER_DISPOSITION_ARTIFACT}`,
        }],
        observationCount: 1,
      })],
    }).projection;
  }
  return recordAutonomyIssueDispositions({
    current,
    updates: [
      {
        issueKey: applied.issueKey,
        semanticRevision: applied.semanticRevision,
        kind:
          (applied.disposition.action === "create-task" || applied.disposition.action === "link-task")
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
  const decoded = readImproverDispositionArtifact(
    join(args.scopeRoot, ".kota"),
    args.sourceRunId,
  );
  if (decoded === null || !isImproverDispositionCurrent(
    args.currentProjection,
    decoded.applied,
  )) {
    return { published: false, nextProjection: args.currentProjection };
  }
  if (decoded.applied.disposition.action === "recover") {
    const issue = args.currentProjection.issues.find((candidate) =>
      candidate.issueKey === decoded.applied.issueKey &&
      candidate.semanticRevision === decoded.applied.semanticRevision
    );
    if (issue !== undefined && !verifyDeterministicRecovery({
      scopeRoot: args.scopeRoot,
      issue,
      recovery: decoded.applied.recovery!,
    })) {
      throw new Error(
        `Recovery publication cannot verify the original health contract for ${issue.rootCauseKey}`,
      );
    }
  }
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
      args.sourceRunId,
    ),
  };
}

export const verifyImproverDispositionAfterReconcile: WorkflowPostReconcileInvariant = (input) => {
  input.signal.throwIfAborted();
  const projection = decodeAutonomyIssueProjection(
    input.readState<AutonomyIssueProjection>(
      AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
    ).value,
  );
  const artifact = readImproverDispositionArtifact(
    input.stateDir,
    input.runId,
  );
  if (artifact === null) {
    if (input.head === input.baseHead && !selectIssueForProjection({
      trigger: input.trigger,
      projection,
    }).eligible) {
      return { satisfied: true };
    }
    return {
      satisfied: false,
      reason: `Improver disposition artifact for ${input.runId} is missing`,
    };
  }
  try {
    verifyGeneratedWorkExistingTask(input.workspaceRoot, artifact.applied.proposal);
  } catch (error) {
    return { satisfied: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return isImproverDispositionCurrent(projection, artifact.applied)
    ? { satisfied: true }
    : {
        satisfied: false,
        reason:
          `Autonomy issue ${artifact.applied.issueKey} revision ` +
          `${artifact.applied.semanticRevision} changed after disposition review`,
      };
};
