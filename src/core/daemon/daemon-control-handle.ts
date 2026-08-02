import type { ChannelStatus } from "#core/channels/channel.js";
import type { SessionGuardrailsReloadSummary } from "#core/events/event-bus-types.js";
import type { EventJsonObject } from "#core/events/event-journal.js";
import type {
  ModuleSetupCompleteInput,
  ModuleSetupFormValues,
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
  ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { CapabilityReadinessResponse } from "./capability-readiness.js";
import type { ClientIdentity } from "./client-identity.js";
import type { DaemonSseEvent } from "./daemon-control-events.js";
import type {
  DaemonControlExtraPayload,
  DeadLetterItem,
  DeadLetterQueueListOptions,
  DeadLetterQueueListResult,
  DeadLetterQueueMutationResult,
  HealthStatus,
  InteractiveSession,
  RegisterSessionResult,
  SetActiveProjectResult,
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowMetricCounts,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "./daemon-control-types.js";
import type { DaemonState } from "./daemon-state.js";
import type { DeadLetterRedriveTarget } from "./dead-letter-queue.js";
import type {
  ScopeAuthorityOperatorAction,
  ScopeAuthorityOperatorRequest,
} from "./scope-authority-operator-token.js";
import type {
  ScopeAuthorityFailure,
  ScopeAuthorityMutation,
  ScopeAuthorityMutationResult,
  ScopeAuthorityValidationResult,
  ScopeAuthorityView,
} from "./scope-authority-types.js";
import type { ScopeHostingState } from "./scope-lifecycle-types.js";
import type { ScopePolicyRouteResponse } from "./scope-policy.js";
import type {
  ProjectId,
  ProjectRegistryProjection,
  ScopeRegistryProjection,
} from "./scope-registry.js";

/** Operations exposed by the daemon control plane. */
export type DaemonControlHandle = {
  getDaemonLiveState(): DaemonState & { running: boolean };
  getHealthStatus(): HealthStatus;
  getWorkflowLiveStatus(projectId?: ProjectId): WorkflowLiveStatus;
  listChannelStatuses(): ChannelStatus[];
  listModuleSetupStatuses(): Promise<ModuleSetupStatusResponse>;
  submitModuleSetupForm(
    moduleName: string,
    requirementId: string,
    values: ModuleSetupFormValues,
  ): Promise<ModuleSetupMutationResult>;
  storeModuleSetupSecret(
    moduleName: string,
    requirementId: string,
    secretValues: Record<string, string>,
  ): Promise<ModuleSetupMutationResult>;
  startModuleSetup(
    moduleName: string,
    requirementId: string,
  ): Promise<ModuleSetupStartResult>;
  completeModuleSetup(
    actionId: string,
    input: ModuleSetupCompleteInput,
  ): Promise<ModuleSetupMutationResult>;
  refreshModuleSetup(
    moduleName: string,
    requirementId: string,
  ): Promise<ModuleSetupMutationResult>;
  revokeModuleSetup(
    moduleName: string,
    requirementId: string,
  ): Promise<ModuleSetupMutationResult>;
  getProjectRegistryProjection(): ProjectRegistryProjection;
  getScopeRegistryProjection(): ScopeRegistryProjection;
  getScopeHostingState(scopeId: ProjectId): ScopeHostingState;
  hasScope(scopeId: string): boolean;
  getScopePolicy(scopeId: string): ScopePolicyRouteResponse;
  inspectScopeAuthority?(scopeId: string): ScopeAuthorityView | ScopeAuthorityFailure;
  validateScopeAuthority?(
    scopeId: string,
    mutation: ScopeAuthorityMutation,
  ): ScopeAuthorityValidationResult;
  applyScopeAuthority?(
    scopeId: string,
    mutation: ScopeAuthorityMutation,
    operatorAction?: ScopeAuthorityOperatorAction,
  ): Promise<ScopeAuthorityMutationResult>;
  answerScopeAuthorityOperatorChallenge?(challenge: string): string | undefined;
  authorizeScopeAuthorityAction?(
    request: ScopeAuthorityOperatorRequest,
    suppliedProof: string | undefined,
  ): ScopeAuthorityOperatorAction | undefined;
  hasProject(projectId: string): boolean;
  getActiveProjectId(): ProjectId | null;
  setActiveProjectId(projectId: ProjectId | null): SetActiveProjectResult;
  pauseWorkflowDispatch(projectId?: ProjectId): { already: boolean };
  resumeWorkflowDispatch(projectId?: ProjectId): {
    already: boolean;
    blocked?: "dirty-recovery";
    message?: string;
  };
  abortActiveRuns(projectId?: ProjectId): { aborted: number };
  abortActiveRun(
    runId: string,
    projectId?: ProjectId,
  ): { ok: boolean; notFound?: boolean; queued?: boolean };
  reloadWorkflowDefinitions(projectId?: ProjectId): { count: number };
  reloadConfig(): Promise<{
    workflows: number;
    changedModules: string[];
    sessionGuardrails: SessionGuardrailsReloadSummary;
  }>;
  getWorkflowDefinitions(projectId?: ProjectId): WorkflowDefinitionSummary[];
  enableWorkflow(name: string, projectId?: ProjectId): { ok: boolean; notFound?: boolean };
  disableWorkflow(name: string, projectId?: ProjectId): { ok: boolean; notFound?: boolean };
  enqueuePendingRun(
    name: string,
    tags?: string[],
    extraPayload?: DaemonControlExtraPayload,
    projectId?: ProjectId,
  ): {
    ok: boolean;
    queued?: string;
    runId?: string;
    alreadyQueued?: boolean;
    error?: string;
    reason?: "scope_not_hosted";
    scopeId?: ProjectId;
    state?: Exclude<ScopeHostingState, "hosted">;
  };
  cancelQueuedRun(
    runId: string,
    projectId?: ProjectId,
  ): { ok: boolean; notFound?: boolean; active?: boolean };
  subscribeToEvents(handler: (event: DaemonSseEvent) => void): () => void;
  listWorkflowRuns(opts?: {
    workflow?: string;
    limit?: number;
    tag?: string;
    causedByRunId?: string;
    projectId?: ProjectId;
  }): WorkflowRunSummary[];
  getWorkflowRun(id: string, projectId?: ProjectId): WorkflowRunDetail | null;
  getWorkflowMetricCounts(projectId?: ProjectId): WorkflowMetricCounts;
  listDeadLetters(opts?: DeadLetterQueueListOptions): DeadLetterQueueListResult;
  getDeadLetter(id: string, projectId?: ProjectId): DeadLetterItem | null;
  dismissDeadLetter(
    id: string,
    reason: string,
    projectId?: ProjectId,
  ): DeadLetterQueueMutationResult;
  redriveDeadLetter(
    id: string,
    reason: string,
    target: DeadLetterRedriveTarget,
    projectId?: ProjectId,
  ): DeadLetterQueueMutationResult;
  exportDeadLetterDiagnostics(id: string, projectId?: ProjectId): EventJsonObject | null;
  probeCapabilityReadiness(): Promise<CapabilityReadinessResponse>;
  getClientIdentity(): Promise<ClientIdentity>;
  registerSession(
    id: string,
    createdAt: string,
    autonomyMode: AutonomyMode,
    projectId?: ProjectId,
  ): RegisterSessionResult;
  unregisterSession(id: string): void;
  listSessions(projectId?: ProjectId): InteractiveSession[];
  setSessionAutonomyMode(id: string, mode: AutonomyMode): {
    ok: boolean;
    notFound?: boolean;
    serveOwned?: boolean;
  };
};
