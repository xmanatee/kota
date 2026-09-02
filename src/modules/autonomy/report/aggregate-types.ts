import type { AgentUsageCost } from "#core/agent-harness/usage.js";
import type { ReviewScrutinyReport } from "#modules/autonomy/review-scrutiny.js";
import type {
  TrajectoryDiagnosticPattern,
} from "#modules/autonomy/trajectory-diagnostic-escalation.js";
import type {
  BlockedPreconditionKind,
} from "#modules/repo-tasks/blocked-precondition.js";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { ShadowSemanticReviewReport } from "../shadow-semantic-review-types.js";
import type { DecisionAttributionReport } from "./decision-attribution-types.js";
import type { DiffSummaryConsistencyReport } from "./diff-summary-consistency-report.js";
import type { OwnerInterventionReport } from "./owner-interventions.js";
import type { PostCompletionFollowUpReport } from "./post-completion-followups.js";
import type {
  ProcessDisciplineReport,
} from "./process-discipline-report.js";
import type { QualityStratificationReport } from "./quality-stratification.js";
import type { SupervisionLoadReport } from "./supervision-load.js";

export type { ShadowSemanticReviewReport } from "../shadow-semantic-review-types.js";
export type { DecisionAttributionReport } from "./decision-attribution-types.js";
export type { DiffSummaryConsistencyReport } from "./diff-summary-consistency-report.js";
export type { OwnerInterventionReport } from "./owner-interventions.js";
export type {
  ProcessDisciplineGradeCount,
  ProcessDisciplineGroupDimension,
  ProcessDisciplineGroupSummary,
  ProcessDisciplineReport,
  ProcessDisciplineReportRecord,
} from "./process-discipline-report.js";
export type { QualityStratificationReport } from "./quality-stratification.js";
export type {
  SupervisionLoadCounts,
  SupervisionLoadEvidence,
  SupervisionLoadReport,
  SupervisionLoadScore,
  SupervisionLoadStatus,
  SupervisionLoadThresholds,
  SupervisionLoadWorkstreamGroup,
} from "./supervision-load.js";

export const DEFAULT_REPORT_WINDOW_DAYS = 7;

export type ReportPriority = "p0" | "p1" | "p2" | "p3" | "unknown";

export type PriorityCount = { priority: ReportPriority; count: number };
export type StateCount = { state: RepoTaskState; count: number };
export type QueueDependencyWait = {
  taskId: string;
  title: string;
  state: RepoTaskState;
  waitingOn: string[];
};

export type QueueBalance = {
  total: number;
  byPriority: PriorityCount[];
  byState: StateCount[];
  waitingOnTasks: QueueDependencyWait[];
};

export type ExplorerTaskAddition = {
  runId: string;
  taskId: string;
  title: string;
  priority: ReportPriority;
};

export type ExplorerBalance = {
  totalRuns: number;
  totalTaskAdditions: number;
  unresolvedTaskAdditions: number;
  taskAdditions: ExplorerTaskAddition[];
};

export type BuilderClosure = {
  runId: string;
  taskId: string;
  taskTitle: string;
  priority: ReportPriority;
  cost: AgentUsageCost;
  durationMs: number | null;
};

export type BuilderCostSummary = {
  commits: number;
  measuredCostRuns: number;
  unavailableCostRuns: number;
  unknownCostRuns: number;
  totalCostUsd: number | null;
};

export type BuilderBreakdown = {
  totalCommittedRuns: number;
  unresolvedClosures: number;
  byPriority: ({ priority: ReportPriority } & BuilderCostSummary)[];
  closures: BuilderClosure[];
};

export type BlockerKind =
  | BlockedPreconditionKind
  | "missing-section"
  | "malformed";

export type BlockerClassMix = {
  totalBlocked: number;
  byKind: { kind: BlockerKind; count: number }[];
};

export type WorkflowCostRow = {
  workflow: string;
  finishedRuns: number;
  measuredRuns: number;
  unavailableRuns: number;
  unknownRuns: number;
  totalCostUsd: number | null;
  averageMeasuredCostUsd: number | null;
};

export type CostBreakdown = {
  totalCostUsd: number | null;
  finishedRuns: number;
  measuredRuns: number;
  unavailableRuns: number;
  unknownRuns: number;
  averageMeasuredCostUsd: number | null;
  byWorkflow: WorkflowCostRow[];
};

export type TrajectoryDiagnosticPatternSummary = {
  workflow: string;
  stepId: string;
  code: TrajectoryDiagnosticPattern["code"];
  runCount: number;
  evidenceArtifactPaths: string[];
};

export type TrajectoryDiagnosticReport = {
  activePatterns: TrajectoryDiagnosticPatternSummary[];
};

export type HealthCountRow<TKey extends string> = {
  [key in TKey]: string;
} & {
  count: number;
};

export type HealthTopGroup = {
  dedupeKey: string;
  labels: string[];
  severity: string;
  actionability: string;
  signalCount: number;
  source: string;
  scope: string;
  status: string;
};

export type AutonomyHealthBreakdown = {
  totalSignals: number;
  totalGroups: number;
  bySeverity: HealthCountRow<"severity">[];
  byLabel: HealthCountRow<"label">[];
  byScope: HealthCountRow<"scope">[];
  bySource: HealthCountRow<"source">[];
  byActionability: HealthCountRow<"actionability">[];
  byStatus: HealthCountRow<"status">[];
  topGroups: HealthTopGroup[];
};

export type AutonomyReportData = {
  windowStartedAt: string;
  windowEndedAt: string;
  windowDays: number;
  supervisionLoad: SupervisionLoadReport;
  openQueue: QueueBalance;
  doneInWindow: QueueBalance;
  explorer: ExplorerBalance;
  builder: BuilderBreakdown;
  decisionAttribution: DecisionAttributionReport;
  diffSummaryConsistency: DiffSummaryConsistencyReport;
  reviewScrutiny: ReviewScrutinyReport;
  shadowSemanticReviews: ShadowSemanticReviewReport;
  trajectoryDiagnostics: TrajectoryDiagnosticReport;
  processDiscipline: ProcessDisciplineReport;
  ownerInterventions: OwnerInterventionReport;
  postCompletionFollowUps: PostCompletionFollowUpReport;
  qualityStratification: QualityStratificationReport;
  health: AutonomyHealthBreakdown;
  blockers: BlockerClassMix;
  cost: CostBreakdown;
};

export type AutonomyReportInput = {
  workspaceRoot: string;
  stateDir: string;
  runsDir: string;
  windowEndMs: number;
  windowDays?: number;
  /**
   * Optional fallback map from commit SHA to repo-relative paths added by that
   * commit. The aggregator consults this map for explorer runs whose commit
   * step output records a `sha` but no inline `addedTaskFiles` array.
   */
};
