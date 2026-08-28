/**
 * Core domain types for the Architecture Gardener vertical slice.
 */

export type ArchitectureObservationKind =
  | "forbidden-core-to-module-dependency"
  | "undeclared-runtime-cross-module-import"
  | "module-dependency-cycle"
  | "duplicate-canonical-ownership"
  | "complexity-concentration"
  | "duplicated-implementation-chunk"
  | "explicit-owner-request";

export type ArchitectureObservationCategory =
  | "dependency-boundary"
  | "canonical-ownership"
  | "complexity"
  | "explicit-request";

export type ArchitectureObservation = {
  readonly id: string;
  readonly kind: ArchitectureObservationKind;
  readonly category: ArchitectureObservationCategory;
  readonly targetScope: string;
  readonly summary: string;
  readonly fingerprint: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
};

export type ArchitectureSignalKind =
  | "structural-violation"
  | "advisory-metric"
  | "explicit-request";

export type ArchitectureSignal = {
  readonly id: string;
  readonly kind: ArchitectureSignalKind;
  readonly category: ArchitectureObservationCategory;
  readonly targetScope: string;
  readonly summary: string;
  readonly fingerprint: string;
  readonly evidence: Readonly<Record<string, unknown>>;
};

export type CandidateDisposition =
  | "accepted"
  | "rejected"
  | "deferred"
  | "cooled_down"
  | "deduplicated"
  | "suppressed";

export type AdmissionEvaluation = {
  readonly targetScope: string;
  readonly admitted: boolean;
  readonly disposition: CandidateDisposition;
  readonly reason: string;
  readonly eligibleSignalCount: number;
  readonly signals: readonly ArchitectureSignal[];
  readonly combinedFingerprint: string;
};

export type StructuralDimension =
  | "deletion"
  | "ownership-collapse"
  | "remove-obsolete-path"
  | "decouple-cycle"
  | "dependency-declaration"
  | "abstraction-consolidation";

export type CandidateAction = {
  readonly type:
    | "delete"
    | "collapse-ownership"
    | "remove-path"
    | "break-cycle"
    | "codemod"
    | "refactor";
  readonly target: string;
  readonly details?: string;
};

export type AbstractionJustification = {
  readonly replacesImplementationCount: number;
  readonly variationAxis: string;
  readonly leavesConsumersSimpler: boolean;
  readonly canonicalOwner: string;
};

export type SimplificationHypothesis = {
  readonly id: string;
  readonly targetScope: string;
  readonly problem: string;
  readonly behaviorPreservationClaim: string;
  readonly structuralImprovement: {
    readonly dimension: StructuralDimension;
    readonly description: string;
  };
  readonly candidateActions: readonly CandidateAction[];
  readonly abstractionJustification?: AbstractionJustification;
  readonly evidenceFingerprints: readonly string[];
  readonly admittedAt: string;
};

export type ParetoEvaluation = {
  readonly hypothesisId: string;
  readonly disposition: "accepted" | "rejected" | "deferred";
  readonly reasons: readonly string[];
  readonly improvedDimensions: readonly string[];
  readonly protectedInvariantsPreserved: boolean;
  readonly score: number;
};

export type StoredFingerprintRecord = {
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly targetScope: string;
  readonly observationKind: ArchitectureObservationKind;
};

export type StoredDispositionRecord = {
  readonly targetScope: string;
  readonly disposition: CandidateDisposition;
  readonly reason: string;
  readonly decidedAt: string;
  readonly taskId?: string;
};

export type ArchitectureGardenerRunState = {
  readonly schemaVersion: 1;
  readonly updatedAt: string;
  readonly lastRunId: string;
  readonly fingerprints: Readonly<Record<string, StoredFingerprintRecord>>;
  readonly dispositions: Readonly<Record<string, StoredDispositionRecord>>;
  readonly cooldowns: Readonly<Record<string, string>>;
};

export type CandidateStatusItem = {
  readonly targetScope: string;
  readonly signals: readonly { readonly kind: string; readonly summary: string }[];
  readonly disposition: CandidateDisposition;
  readonly reason: string;
  readonly activeTaskId?: string;
};

export type ArchitectureGardenerStatus = {
  readonly summary: {
    readonly totalObservations: number;
    readonly observationsByKind: Readonly<Record<string, number>>;
    readonly totalCandidatesEvaluated: number;
    readonly acceptedCount: number;
    readonly rejectedCount: number;
    readonly deferredCount: number;
    readonly cooledDownCount: number;
    readonly suppressedCount: number;
    readonly deduplicatedCount: number;
  };
  readonly candidates: readonly CandidateStatusItem[];
  readonly activeTasks: readonly {
    readonly taskId: string;
    readonly title: string;
    readonly targetScope: string;
  }[];
};
