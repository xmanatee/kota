import type {
  WorkflowBatchDispatchInput,
  WorkflowBatchDispatchResult,
} from "#core/workflow/event-batches.js";
import type { WorkflowBatchOverflowPolicy } from "#core/workflow/trigger-types.js";
import type { WorkflowTriggerOptions, WorkflowTriggerResult } from "#modules/workflow-ops/client.js";
import type {
  InboundSignalActorTrust,
  InboundSignalJsonObject,
  InboundSignalReceivedPayload,
  InboundSignalRouteDecision,
  InboundSignalRoutedPayload,
  InboundSignalSourceStatus,
} from "./events.js";

export type InboundSignalWorkflowRouteTargetConfig = {
  kind: "workflow";
  name: string;
  batch?: InboundSignalBatchPolicy;
};

export type InboundSignalAgentRouteTargetConfig = {
  kind: "agent";
  name: string;
  maxTurns: number;
};

export type InboundSignalRouteTargetConfig =
  | InboundSignalWorkflowRouteTargetConfig
  | InboundSignalAgentRouteTargetConfig;

export type InboundSignalBatchPolicy = {
  mode: "workflow-trigger";
  maxItems?: number;
  maxAgeMs?: number;
  idleMs?: number;
  maxBufferSize?: number;
  overflow?: WorkflowBatchOverflowPolicy;
  groupBy?: readonly InboundSignalRouteMatchField[];
};

export type InboundSignalProcessingPolicy = {
  classifier?: "none" | "cheap";
  modelTier?: "fast" | "balanced" | "capable";
  allowNonReadActions?: boolean;
};

export type InboundSignalRouteConfig = {
  id: string;
  provider?: string;
  channel?: string;
  accountId?: string;
  sourceId?: string;
  actorTrust?: InboundSignalActorTrust;
  scopeId?: string;
  sourceStatus?: InboundSignalSourceStatus;
  blockedHandling?: "audit-only" | "dispatch";
  targets: readonly InboundSignalRouteTargetConfig[];
  batch?: InboundSignalBatchPolicy;
  processing?: InboundSignalProcessingPolicy;
};

export type InboundSignalRoutingConfig = {
  routes?: readonly InboundSignalRouteConfig[];
};

export type InboundSignalRouteMatchField =
  | "provider"
  | "channel"
  | "accountId"
  | "sourceId"
  | "actorTrust";

export type InboundSignalRouteValidationContext = {
  workflowNames: ReadonlySet<string>;
  agentNames: ReadonlySet<string>;
};

export type InboundSignalRouteValidationError = {
  routeId: string;
  message: string;
};

export type InboundSignalRouteValidationResult =
  | { ok: true; routes: readonly InboundSignalRouteConfig[] }
  | { ok: false; errors: readonly InboundSignalRouteValidationError[] };

export type InboundSignalRouteProjection = {
  id: string;
  provider: string;
  channel: string;
  accountId: string;
  sourceId: string;
  actorTrust: string;
  scopeId: string;
  sourceStatus: InboundSignalSourceStatus;
  blockedHandling: "audit-only" | "dispatch";
  targets: readonly InboundSignalRouteTargetConfig[];
  batch: InboundSignalJsonObject | null;
  processing: InboundSignalJsonObject | null;
};

export type InboundSignalRoutingStatus = {
  routes: readonly InboundSignalRouteProjection[];
  validation: InboundSignalRouteValidationResult;
};

export type InboundSignalAgentTriggerOptions = {
  maxTurns: number;
  autonomyMode: "passive" | "autonomous";
  payload: InboundSignalJsonObject;
};

export type InboundSignalAgentTriggerResult =
  | { ok: true; sessionId?: string }
  | { ok: false; reason: string };

export type InboundSignalRouteOutcomeBase = {
  route: InboundSignalRouteConfig | null;
  decision: InboundSignalRouteDecision;
  sourceStatus: InboundSignalSourceStatus;
  reason: string;
};

export type InboundSignalRouteDispatchDependency = {
  triggerWorkflow(
    name: string,
    options: WorkflowTriggerOptions,
  ): Promise<WorkflowTriggerResult>;
  batchWorkflow?(
    input: WorkflowBatchDispatchInput,
  ): Promise<WorkflowBatchDispatchResult> | WorkflowBatchDispatchResult;
  triggerAgent?: (
    name: string,
    options: InboundSignalAgentTriggerOptions,
  ) => Promise<InboundSignalAgentTriggerResult>;
  emitRouted(payload: InboundSignalRoutedPayload): void;
};

export type InboundSignalRouteDispatchArgs = {
  config: InboundSignalRoutingConfig;
  signal: InboundSignalReceivedPayload;
  context: InboundSignalRouteValidationContext;
  deps: InboundSignalRouteDispatchDependency;
};
