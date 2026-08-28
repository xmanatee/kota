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
import type { WorkflowEnqueueOptions } from "#core/workflow/operator-trigger.js";
import type { CapabilityReadinessResponse } from "./capability-readiness.js";
import type { ClientIdentity } from "./client-identity.js";
import type { DaemonSseEvent } from "./daemon-control-events.js";
import type {
  DeadLetterItem,
  DeadLetterQueueListOptions,
  DeadLetterQueueListResult,
  DeadLetterQueueMutationResult,
  HealthStatus,
  InteractiveSession,
  RegisterSessionResult,
  SetActiveScopeResult,
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowMetricCounts,
  WorkflowResumeOptions,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "./daemon-control-types.js";
import type { DaemonState } from "./daemon-state.js";
import type { DeadLetterRedriveTarget } from "./dead-letter-queue.js";
import type {
  LifecycleStatusOptions,
  LifecycleStatusReport,
  LifecycleSweepOptions,
  LifecycleSweepReport,
} from "./lifecycle-collector-types.js";
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
  ScopeId,
  ScopeRegistryProjection,
} from "./scope-registry.js";

/** Operations exposed by the daemon control plane. */
export type DaemonControlHandle = {
  getDaemonLiveState(): DaemonState & { running: boolean };
  getHealthStatus(): HealthStatus;
  getWorkflowLiveStatus(scopeId?: ScopeId): WorkflowLiveStatus;
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
  getScopeRegistryProjection(): ScopeRegistryProjection;
  getScopeHostingState(scopeId: ScopeId): ScopeHostingState;
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
  getActiveScopeId(): ScopeId | null;
  setActiveScopeId(scopeId: ScopeId | null): SetActiveScopeResult;
  pauseWorkflowDispatch(scopeId?: ScopeId): { already: boolean };
  resumeWorkflowDispatch(scopeId?: ScopeId, options?: WorkflowResumeOptions): {
    already: boolean;
    agentBackoffCleared?: true;
  };
  abortActiveRuns(scopeId?: ScopeId): { aborted: number };
  abortActiveRun(
    runId: string,
    scopeId?: ScopeId,
  ): { ok: boolean; notFound?: boolean; queued?: boolean };
  reloadWorkflowDefinitions(scopeId?: ScopeId): { count: number };
  reloadConfig(): Promise<{
    workflows: number;
    changedModules: string[];
    sessionGuardrails: SessionGuardrailsReloadSummary;
  }>;
  getWorkflowDefinitions(scopeId?: ScopeId): WorkflowDefinitionSummary[];
  enableWorkflow(name: string, scopeId?: ScopeId): { ok: boolean; notFound?: boolean };
  disableWorkflow(name: string, scopeId?: ScopeId): { ok: boolean; notFound?: boolean };
  enqueuePendingRun(
    name: string,
    options?: WorkflowEnqueueOptions,
    scopeId?: ScopeId,
  ): {
    ok: boolean;
    queued?: string;
    runId?: string;
    alreadyQueued?: boolean;
    error?: string;
    reason?: "scope_not_hosted";
    scopeId?: ScopeId;
    state?: Exclude<ScopeHostingState, "hosted">;
  };
  cancelQueuedRun(
    runId: string,
    scopeId?: ScopeId,
  ): {
    ok: boolean;
    notFound?: boolean;
    active?: boolean;
    preserved?: boolean;
    blockers?: string[];
  };
  subscribeToEvents(handler: (event: DaemonSseEvent) => void): () => void;
  listWorkflowRuns(opts?: {
    workflow?: string;
    limit?: number;
    tag?: string;
    causedByRunId?: string;
    scopeId?: ScopeId;
  }): WorkflowRunSummary[];
  getWorkflowRun(id: string, scopeId?: ScopeId): WorkflowRunDetail | null;
  getWorkflowMetricCounts(scopeId?: ScopeId): WorkflowMetricCounts;
  listDeadLetters(opts?: DeadLetterQueueListOptions): DeadLetterQueueListResult;
  getDeadLetter(id: string, scopeId?: ScopeId): DeadLetterItem | null;
  dismissDeadLetter(
    id: string,
    reason: string,
    scopeId?: ScopeId,
  ): DeadLetterQueueMutationResult;
  redriveDeadLetter(
    id: string,
    reason: string,
    target: DeadLetterRedriveTarget,
    scopeId?: ScopeId,
  ): DeadLetterQueueMutationResult;
  exportDeadLetterDiagnostics(id: string, scopeId?: ScopeId): EventJsonObject | null;
  probeCapabilityReadiness(): Promise<CapabilityReadinessResponse>;
  getClientIdentity(): Promise<ClientIdentity>;
  registerSession(
    id: string,
    createdAt: string,
    autonomyMode: AutonomyMode,
    scopeId?: ScopeId,
  ): RegisterSessionResult;
  unregisterSession(id: string): void;
  listSessions(scopeId?: ScopeId): InteractiveSession[];
  setSessionAutonomyMode(id: string, mode: AutonomyMode): {
    ok: boolean;
    notFound?: boolean;
    serveOwned?: boolean;
  };
  getLifecycleStatus?(options?: LifecycleStatusOptions): Promise<LifecycleStatusReport>;
  runLifecycleSweep?(options?: LifecycleSweepOptions): Promise<LifecycleSweepReport>;
};
