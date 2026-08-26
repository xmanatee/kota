import { readSupervisionLoadStores } from "./supervision-load-readers.js";
import { buildTopReferences } from "./supervision-load-references.js";
import { scoreSupervisionLoad } from "./supervision-load-scoring.js";
import type { SupervisionLoadCounts } from "./supervision-load-types.js";
import {
  type BuildSupervisionLoadReportInput,
  DEFAULT_SUPERVISION_LOAD_THRESHOLDS,
  type SupervisionLoadReport,
} from "./supervision-load-types.js";
import { buildWorkstreamGroups } from "./supervision-load-workstreams.js";

export type {
  BuildSupervisionLoadReportInput,
  SupervisionLoadCounts,
  SupervisionLoadEvidence,
  SupervisionLoadEvidenceSource,
  SupervisionLoadEvidenceStatus,
  SupervisionLoadReference,
  SupervisionLoadReferenceKind,
  SupervisionLoadReport,
  SupervisionLoadScore,
  SupervisionLoadStatus,
  SupervisionLoadThresholds,
  SupervisionLoadWeights,
  SupervisionLoadWorkstreamGroup,
} from "./supervision-load-types.js";

export function buildSupervisionLoadReport(
  input: BuildSupervisionLoadReportInput,
): SupervisionLoadReport {
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const stores = readSupervisionLoadStores({
    projectDir: input.projectDir,
    runsDir: input.runsDir,
    runs: input.runs,
  });

  const approvalItems = stores.approvals.items;
  const questionItems = stores.ownerQuestions.items;
  const deadLetterItems = stores.deadLetters.items;
  const attentionRecords = stores.attentionItems.items;
  const counts = buildCounts({
    activeRunCount: stores.activeRuns.items?.length ?? null,
    approvalItems,
    questionItems,
    deadLetterItems,
    attentionRecords,
    postCompletionFollowUps:
      input.postCompletionFollowUps.totalCorrectiveFollowUps,
    reviewEvidenceGaps:
      input.reviewScrutiny.thinAcceptances +
      input.reviewScrutiny.absentMetricCount +
      input.reviewScrutiny.unsupportedArtifacts,
  });

  const evidence = [
    stores.activeRuns.evidence,
    stores.approvals.evidence,
    stores.ownerQuestions.evidence,
    stores.deadLetters.evidence,
    stores.attentionItems.evidence,
  ];
  const score = scoreSupervisionLoad(counts, evidence);

  return {
    generatedAt: new Date(input.windowEndMs).toISOString(),
    status: score.status,
    counts,
    score,
    thresholds: DEFAULT_SUPERVISION_LOAD_THRESHOLDS,
    evidence,
    workstreams: buildWorkstreamGroups(stores.activeRuns.items ?? [], taskById),
    topReferences: buildTopReferences({
      activeRuns: stores.activeRuns.items ?? [],
      approvals: approvalItems ?? [],
      ownerQuestions: questionItems ?? [],
      deadLetters: deadLetterItems ?? [],
      attentionItems: attentionRecords ?? [],
      postCompletionFollowUps: input.postCompletionFollowUps,
      taskById,
    }),
  };
}

function buildCounts(input: {
  activeRunCount: number | null;
  approvalItems: NonNullable<
    ReturnType<typeof readSupervisionLoadStores>["approvals"]["items"]
  > | null;
  questionItems: NonNullable<
    ReturnType<typeof readSupervisionLoadStores>["ownerQuestions"]["items"]
  > | null;
  deadLetterItems: NonNullable<
    ReturnType<typeof readSupervisionLoadStores>["deadLetters"]["items"]
  > | null;
  attentionRecords: NonNullable<
    ReturnType<typeof readSupervisionLoadStores>["attentionItems"]["items"]
  > | null;
  postCompletionFollowUps: number;
  reviewEvidenceGaps: number;
}): SupervisionLoadCounts {
  return {
    activeRuns: input.activeRunCount,
    pendingApprovals:
      input.approvalItems?.filter((item) => item.status === "pending").length ??
      null,
    pendingOwnerQuestions:
      input.questionItems?.filter((item) => item.status === "pending").length ??
      null,
    openDeadLetters:
      input.deadLetterItems?.filter((item) => item.status === "open").length ??
      null,
    attentionItems: input.attentionRecords?.length ?? null,
    postCompletionFollowUps: input.postCompletionFollowUps,
    reviewEvidenceGaps: input.reviewEvidenceGaps,
  };
}
