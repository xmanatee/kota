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
  | "delivery-friction";

export type ArchitectureObservationCategory =
  | "dependency-boundary"
  | "canonical-ownership"
  | "complexity"
  | "delivery";

export type ArchitectureObservation = {
  readonly id: string;
  readonly kind: ArchitectureObservationKind;
  readonly category: ArchitectureObservationCategory;
  readonly targetScope: string;
  /** Repository-relative source files or owning directories involved in this observation. */
  readonly affectedPaths: readonly string[];
  readonly summary: string;
  readonly fingerprint: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
};

export type CandidateDisposition = "admitted" | "proposed" | "no-action" | "covered" | "suppressed";

export type StoredDispositionRecord = {
  readonly targetScope: string;
  readonly disposition: CandidateDisposition;
  readonly reason: string;
  readonly decidedAt: string;
  readonly taskId: string | null;
};

export type ArchitectureGardenerRunState = {
  readonly schemaVersion: 2;
  readonly updatedAt: string;
  readonly lastRunId: string;
  readonly reviewedTaskEvidence: readonly string[];
  readonly linkedTaskIds: readonly string[];
  readonly reviewedCohorts: Readonly<Record<string, string>>;
  readonly dispositions: Readonly<Record<string, StoredDispositionRecord>>;
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
  };
  readonly candidates: readonly CandidateStatusItem[];
  readonly activeTasks: readonly {
    readonly taskId: string;
    readonly title: string;
    readonly targetScope: string;
  }[];
};
