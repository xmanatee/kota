import type { RepositoryAccess, RunSandbox } from "./run-sandbox.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

export type DurableRunState =
  | "queued"
  | "running"
  | "waiting"
  | "integrating"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needs_attention";

export type AdmittedRun = {
  id: string;
  projectId: string;
  workflow: string;
  trigger: WorkflowRunTrigger;
  repository: RepositoryAccess;
  resources: readonly string[];
  admittedAt: string;
  notBeforeAt?: string;
  admission?: RunAdmissionIdentity;
};

export type RunAdmissionIdentity = Readonly<{
  scopeId: string;
  key: string;
  parameterFingerprint: string;
}>;

export type RunAdmissionDisposition = Readonly<{
  status: "admitted" | "updated" | "duplicate";
  runId: string;
}>;

export type StoredRun = {
  id: string;
  projectId: string;
  workflow: string;
  trigger: WorkflowRunTrigger;
  repository: RepositoryAccess;
  state: DurableRunState;
  resources: string[];
  admittedAt: string;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  notBeforeAt?: string;
  sandbox?: RunSandbox;
  integration?: Record<string, unknown>;
  processes: Record<string, unknown>[];
  wait?: Record<string, unknown>;
  lastError?: string;
};

/** A terminal event committed atomically with the run that produced it. */
export type RunPublication = Readonly<{
  id: string;
  runId: string;
  projectId: string;
  event: string;
  payload: Readonly<Record<string, unknown>>;
  createdAt: string;
  deliveredAt?: string;
}>;

export type PendingRunPublication = Omit<RunPublication, "deliveredAt">;

export type ProjectStateValue<T = unknown> = Readonly<{
  revision: number;
  value: T | null;
}>;

export type RestartRecoveryAttempt = Readonly<{
  runId: string;
  previousEpoch: number;
  processes: readonly Record<string, unknown>[];
}>;

export type ExternalEffectState = "prepared" | "completed" | "unknown";

export type StoredExternalEffect = {
  key: string;
  runId: string;
  requestFingerprint: string;
  state: ExternalEffectState;
  preparedAt: string;
  completedAt?: string;
  result?: unknown;
};

export type RunSuspensionState = Extract<
  DurableRunState,
  "waiting" | "needs_attention"
>;

export type TerminalRunState = Extract<
  DurableRunState,
  "succeeded" | "failed" | "cancelled"
>;

export class AdmissionKeyConflictError extends Error {
  constructor(
    readonly scopeId: string,
    readonly key: string,
  ) {
    super(`Admission key "${key}" in scope "${scopeId}" was reused with different parameters`);
    this.name = "AdmissionKeyConflictError";
  }
}

export class PublicationIntentConflictError extends Error {
  constructor(
    readonly runId: string,
    readonly stepId: string,
  ) {
    super(
      `Emit intent for run "${runId}" step "${stepId}" was replayed with a different event or payload`,
    );
    this.name = "PublicationIntentConflictError";
  }
}

export class StateValueConflictError extends Error {
  constructor(
    readonly projectId: string,
    readonly key: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
    readonly pendingRunId?: string,
  ) {
    super(
      pendingRunId === undefined
        ? `State value "${key}" in project "${projectId}" is at revision ${actualRevision}, expected ${expectedRevision}`
        : `State value "${key}" in project "${projectId}" has a pending mutation owned by run "${pendingRunId}"`,
    );
    this.name = "StateValueConflictError";
  }
}

export class StaleDaemonEpochError extends Error {
  constructor(readonly epoch: number, readonly currentEpoch: number) {
    super(`Daemon epoch ${epoch} is stale; current epoch is ${currentEpoch}`);
    this.name = "StaleDaemonEpochError";
  }
}
