import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { ReviewScrutinyReport } from "#modules/autonomy/review-scrutiny.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  PostCompletionCorrectiveLink,
  PostCompletionFollowUpReport,
} from "./post-completion-followups.js";
import { buildPostCompletionQualityObservations } from "./quality-stratification-post-completion-observations.js";
import { buildReviewQualityObservations } from "./quality-stratification-review-observations.js";
import { buildQualityRunIndexes } from "./quality-stratification-run-indexes.js";
import type { QualityObservation } from "./quality-stratification-types.js";

export type BuildQualityStratificationReportInput = {
  tasks: readonly RepoTaskFullRecord[];
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
  windowStartMs: number;
  windowEndMs: number;
  reviewScrutiny: ReviewScrutinyReport;
  priorReviewScrutiny: ReviewScrutinyReport;
  postCompletionFollowUps: PostCompletionFollowUpReport;
  priorPostCompletionFollowUps: PostCompletionFollowUpReport;
  postCompletionFollowUpLinks?: readonly PostCompletionCorrectiveLink[];
  priorPostCompletionFollowUpLinks?: readonly PostCompletionCorrectiveLink[];
};

export function buildQualityObservations(
  input: BuildQualityStratificationReportInput,
): QualityObservation[] {
  const indexes = buildQualityRunIndexes(input);
  const priorWindowStartMs =
    input.windowStartMs - (input.windowEndMs - input.windowStartMs);
  const priorWindowEndMs = input.windowStartMs - 1;
  return [
    ...buildReviewQualityObservations(input.reviewScrutiny, "current", indexes),
    ...buildReviewQualityObservations(
      input.priorReviewScrutiny,
      "prior",
      indexes,
    ),
    ...buildPostCompletionQualityObservations(
      input,
      indexes,
      input.postCompletionFollowUpLinks ?? input.postCompletionFollowUps.links,
      "current",
      input.windowStartMs,
      input.windowEndMs,
    ),
    ...buildPostCompletionQualityObservations(
      input,
      indexes,
      input.priorPostCompletionFollowUpLinks ??
        input.priorPostCompletionFollowUps.links,
      "prior",
      priorWindowStartMs,
      priorWindowEndMs,
    ),
  ];
}
