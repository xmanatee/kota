import type {
  OwnerQuestionAnswerBehavior,
  OwnerQuestionOrigin,
  OwnerQuestionStatus,
} from "#core/daemon/owner-question-queue.js";
import type { OwnerInterventionEscalationReport } from "../owner-intervention-escalation-types.js";

export type OwnerInterventionOutcomeBucket =
  | "proposed-option"
  | "freeform-correction"
  | "provider-noise-dismissal"
  | "setup-action"
  | "ambiguous-answer"
  | "not-answered";

export type OwnerInterventionMarker =
  | "legacy-origin"
  | "legacy-answer-behavior"
  | "stale-pending"
  | "resolved-by-timeout";

export type OwnerInterventionRecord = {
  questionId: string;
  status: OwnerQuestionStatus;
  createdAt: string;
  resolvedAt: string | null;
  source: string;
  originKind: OwnerQuestionOrigin["kind"];
  workflowName: string | null;
  runId: string | null;
  stepId: string | null;
  taskId: string | null;
  answerBehavior: OwnerQuestionAnswerBehavior;
  outcomeBucket: OwnerInterventionOutcomeBucket;
  ageDays: number;
  refs: {
    question: string;
    workflow: string | null;
    run: string | null;
    task: string | null;
  };
  markers: OwnerInterventionMarker[];
};

export type OwnerInterventionPressureBucket = {
  key: string;
  total: number;
  stalePending: number;
  timeouts: number;
  answeredCorrections: number;
};

export type OwnerInterventionCountRow<TKey extends string> = {
  [key in TKey]: string;
} & {
  count: number;
};

export type OwnerInterventionReport = {
  totalQuestions: number;
  pending: number;
  stalePending: number;
  answered: number;
  answeredCorrections: number;
  dismissed: number;
  timeouts: number;
  legacyUnknown: number;
  byStatus: OwnerInterventionCountRow<"status">[];
  byOutcome: OwnerInterventionCountRow<"outcome">[];
  byAnswerBehavior: OwnerInterventionCountRow<"answerBehavior">[];
  bySource: OwnerInterventionPressureBucket[];
  byWorkflow: OwnerInterventionPressureBucket[];
  byTask: OwnerInterventionPressureBucket[];
  records: OwnerInterventionRecord[];
  recurringPatterns: OwnerInterventionEscalationReport;
};

export function emptyOwnerInterventionReport(): OwnerInterventionReport {
  return {
    totalQuestions: 0,
    pending: 0,
    stalePending: 0,
    answered: 0,
    answeredCorrections: 0,
    dismissed: 0,
    timeouts: 0,
    legacyUnknown: 0,
    byStatus: [],
    byOutcome: [],
    byAnswerBehavior: [],
    bySource: [],
    byWorkflow: [],
    byTask: [],
    records: [],
    recurringPatterns: {
      activePatterns: [],
      ignoredPatterns: [],
      belowThresholdPatterns: [],
    },
  };
}
