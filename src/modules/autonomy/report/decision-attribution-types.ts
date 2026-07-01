import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { ReviewScrutinyRecord } from "#modules/autonomy/review-scrutiny.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { OwnerInterventionReport } from "./owner-interventions.js";

export type DecisionAttribution = "owner" | "kota" | "mixed" | "unknown";

export type DecisionHardSuccessSignal =
  | "accepted-critic-verdict"
  | "committed-task-completion"
  | "owner-acceptance"
  | "passing-validation"
  | "rendered-product-evidence";

export type DecisionTroubleSignal =
  | "abandoned-work"
  | "claimed-success-without-hard-evidence"
  | "failed-critic-verdict"
  | "failed-run"
  | "failed-tests"
  | "owner-correction"
  | "repair-loop-exhaustion"
  | "repeated-retries"
  | "weak-product-success-evidence";

export type DecisionAttributionWarningKind =
  | "kota-planning-without-context"
  | "success-lacks-hard-evidence";

export type DecisionPlanningContext = "owner-or-domain" | "insufficient";

export type DecisionAttributionRecord = {
  runId: string;
  workflow: string;
  workMode: string;
  taskId: string | null;
  taskTitle: string | null;
  planning: DecisionAttribution;
  planningContext: DecisionPlanningContext;
  execution: DecisionAttribution;
  hardSuccessSignals: DecisionHardSuccessSignal[];
  troubleSignals: DecisionTroubleSignal[];
  refs: string[];
};

export type DecisionAttributionWarning = {
  kind: DecisionAttributionWarningKind;
  count: number;
  refs: string[];
  message: string;
};

export type DecisionAttributionCount<TKey extends string> = {
  [key in TKey]: string;
} & {
  count: number;
};

export type DecisionAttributionReport = {
  totalRuns: number;
  byPlanning: DecisionAttributionCount<"attribution">[];
  byExecution: DecisionAttributionCount<"attribution">[];
  byWorkMode: DecisionAttributionCount<"workMode">[];
  hardSuccessSignals: DecisionAttributionCount<"signal">[];
  troubleSignals: DecisionAttributionCount<"signal">[];
  warnings: DecisionAttributionWarning[];
  records: DecisionAttributionRecord[];
};

export type DecisionAttributionReportInput = {
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
  taskById: ReadonlyMap<string, RepoTaskFullRecord>;
  reviewRecords: readonly ReviewScrutinyRecord[];
  ownerInterventions: OwnerInterventionReport;
};
