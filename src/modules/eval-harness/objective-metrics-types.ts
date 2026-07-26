import type {
  ExecutionBackendKind,
  ExecutionProfileNonGatingReason,
  ExecutionProfilePreflightResult,
  ExecutionProfileRejectionReason,
  ExecutionProfileVerification,
  ResourceProfile,
} from "./fixture-run.js";

export type ObjectiveMetricJsonValue =
  | null
  | boolean
  | number
  | string
  | ObjectiveMetricJsonValue[]
  | { [key: string]: ObjectiveMetricJsonValue };

export type ObjectiveMetricDirection =
  | "lower_is_better"
  | "higher_is_better";

export type ObjectiveMetricSource =
  | { kind: "json-file"; path: string; pointer: string }
  | { kind: "text-file"; path: string; pattern?: string }
  | { kind: "shell"; command: string; timeoutMs?: number };

export type ObjectiveMetricExecutionProfileSummary = {
  status: ExecutionProfilePreflightResult["status"];
  backendKind: ExecutionBackendKind;
  verification: ExecutionProfileVerification;
  gateEligible: boolean;
  reason?:
    | "verified-profile"
    | ExecutionProfileNonGatingReason
    | ExecutionProfileRejectionReason;
};

export type ObjectiveMetricComparisonBaseline = {
  value: number;
  resourceProfile: ResourceProfile;
  executionProfile: {
    status: "verified";
    backendKind: Exclude<ExecutionBackendKind, "missing-isolation-backend">;
    verification: Exclude<ExecutionProfileVerification, "unverified">;
    gateEligible: true;
  };
};

export type ObjectiveMetricSpec = {
  name: string;
  unit: string;
  direction: ObjectiveMetricDirection;
  source: ObjectiveMetricSource;
  comparisonBaseline?: ObjectiveMetricComparisonBaseline;
};

export type ObjectiveMetricComparison =
  | {
      status: "compared";
      baselineValue: number;
      currentValue: number;
      delta: number;
      improved: boolean;
      direction: ObjectiveMetricDirection;
      baselineResourceProfile: ResourceProfile;
      currentResourceProfile: ResourceProfile;
      baselineExecutionProfile: ObjectiveMetricComparisonBaseline["executionProfile"];
      currentExecutionProfile: ObjectiveMetricExecutionProfileSummary;
    }
  | {
      status: "not-compared";
      reason:
        | "resource-profile-incomparable"
        | "execution-profile-incomparable";
      baselineValue: number;
      currentValue: number;
      direction: ObjectiveMetricDirection;
      baselineResourceProfile: ResourceProfile;
      currentResourceProfile: ResourceProfile;
      baselineExecutionProfile: ObjectiveMetricComparisonBaseline["executionProfile"];
      currentExecutionProfile: ObjectiveMetricExecutionProfileSummary;
    };

export type ObservedObjectiveMetric = {
  fixtureId: string;
  name: string;
  unit: string;
  direction: ObjectiveMetricDirection;
  source: ObjectiveMetricSource;
  value: number;
  runIndex: number;
  repeatCount: number;
  resourceProfile: ResourceProfile;
  executionProfile: ObjectiveMetricExecutionProfileSummary;
  comparisonBaseline?: ObjectiveMetricComparisonBaseline;
  comparison?: ObjectiveMetricComparison;
};

export type ObjectiveMetricObservationError = {
  fixtureId: string;
  metricName: string;
  source: ObjectiveMetricSource;
  reason: ObjectiveMetricValidationReason;
  message: string;
};

export type ObjectiveMetricEvaluation = {
  objectiveMetrics: ObservedObjectiveMetric[];
  objectiveMetricErrors: ObjectiveMetricObservationError[];
};

export type ObjectiveMetricResourceComparison =
  | { status: "comparable"; resourceProfile: ResourceProfile }
  | {
      status: "not-comparable";
      reason: "mixed-resource-profiles";
      resourceProfiles: ResourceProfile[];
    };

export type ObjectiveMetricExecutionComparison =
  | {
      status: "comparable";
      executionProfile: ObjectiveMetricExecutionProfileSummary;
    }
  | {
      status: "not-comparable";
      reason: "mixed-execution-profiles" | "non-gating-execution-profile";
      executionProfiles: ObjectiveMetricExecutionProfileSummary[];
    };

export type AggregateObjectiveMetric = {
  fixtureId: string;
  name: string;
  unit: string;
  direction: ObjectiveMetricDirection;
  sampleCount: number;
  values: number[];
  min: number;
  max: number;
  mean: number;
  resourceProfileComparison: ObjectiveMetricResourceComparison;
  executionProfileComparison: ObjectiveMetricExecutionComparison;
  comparisonBaseline?: ObjectiveMetricComparisonBaseline;
  comparison?: ObjectiveMetricComparison;
};

export type ObjectiveMetricValidationReason =
  | "malformed-declaration"
  | "missing-source"
  | "nonnumeric-value"
  | "source-failed"
  | "environment-incomparable";

export class ObjectiveMetricValidationError extends Error {
  readonly reason: ObjectiveMetricValidationReason;
  readonly fixtureId: string | null;
  readonly metricName: string | null;

  constructor(
    reason: ObjectiveMetricValidationReason,
    message: string,
    options: { fixtureId?: string; metricName?: string } = {},
  ) {
    super(message);
    this.name = "ObjectiveMetricValidationError";
    this.reason = reason;
    this.fixtureId = options.fixtureId ?? null;
    this.metricName = options.metricName ?? null;
  }
}
