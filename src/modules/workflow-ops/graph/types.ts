import type { ModuleEventPayloadSchema } from "#core/events/module-event.js";
import type { EvidenceJsonObject } from "#core/evidence/policy.js";
import type {
  WorkflowBatchOverflowPolicy,
  WorkflowRunTrigger,
} from "#core/workflow/trigger-types.js";

/**
 * Workflow graph data types — reusable by CLI, HTTP API, and client apps.
 *
 * These types describe the assembled workflow/trigger/event topology without
 * coupling to any particular rendering format.
 */

export type TriggerSummary = {
  event: string;
  filter?: string;
  schedule?: string;
  intervalMs?: number;
  watch?: string[];
  cooldownMs?: number;
  webhook?: boolean;
};

export type StepSummary = {
  id: string;
  type: "tool" | "agent" | "emit" | "restart" | "code" | "trigger" | "parallel" | "branch" | "foreach" | "approval" | "await-event";
  agentName?: string;
  model?: string;
  tool?: string;
  manifestEffect?: {
    moduleName: string;
    effectId: string;
    risk: string;
    categories: readonly string[];
    capabilityIds: readonly string[];
    effect: {
      kind: string;
      scope: string;
      openWorld: boolean;
    };
    simulation: {
      blocked: boolean;
      reason?: string;
    };
  };
  event?: string;
  targetWorkflow?: string;
  hasCondition: boolean;
  children?: StepSummary[];
};

export type WorkflowNode = {
  name: string;
  description?: string;
  enabled: boolean;
  tags: readonly string[];
  concurrencyGroup?: string;
  triggers: TriggerSummary[];
  steps: StepSummary[];
  /** Event names this workflow listens to (derived from triggers). */
  listensTo: { event: string; filter?: string }[];
  /** Event names this workflow emits (derived from emit steps). */
  emits: string[];
  /** Workflow names this workflow triggers directly (derived from trigger steps). */
  directTriggers: string[];
  /** Agent names used by this workflow's agent steps. */
  agents: string[];
};

export type EventNode = {
  name: string;
  producers: string[];
  consumers: string[];
};

export type WorkflowGraph = {
  workflows: WorkflowNode[];
  events: EventNode[];
  /** All distinct agent names referenced across workflows. */
  agents: string[];
};

export type AutomationSchemaSummary = {
  name: string;
  version: number;
  declared: boolean;
  scope?: "project" | "daemon";
  module?: string;
  sensitivity?: "public" | "internal" | "sensitive" | "secret";
  filterablePaths: readonly string[];
  payloadSchema?: ModuleEventPayloadSchema;
};

export type AutomationBatchSummary = {
  maxCount?: number;
  maxAgeMs?: number;
  idleTimeoutMs?: number;
  groupBy: readonly string[];
  flushEvent?: string;
  maxBufferSize: number;
  overflow: WorkflowBatchOverflowPolicy;
};

export type AutomationPolicyGate = {
  kind:
    | "scope-policy"
    | "setup"
    | "owner-confirmation"
    | "approval"
    | "idempotency"
    | "simulation";
  source: string;
  outcome: "allow" | "confirm" | "block" | "unknown";
  reason: string;
  capabilityIds?: readonly string[];
  setupRequirementIds?: readonly string[];
  stepId?: string;
};

export type AutomationBlocker = {
  kind:
    | "setup"
    | "owner-confirmation"
    | "approval"
    | "idempotency"
    | "schema"
    | "source"
    | "runtime-data";
  workflow?: string;
  event?: string;
  stepId?: string;
  moduleName?: string;
  capabilityIds?: readonly string[];
  setupRequirementId?: string;
  state?: string;
  reason: string;
};

export type AutomationEffectSummary = {
  moduleName: string;
  effectId: string;
  source: string;
  target: string;
  risk: string;
  categories: readonly string[];
  capabilityIds: readonly string[];
  effect: {
    kind: string;
    scope: string;
    openWorld: boolean;
  };
  simulation: {
    blocked: boolean;
    reason?: string;
  };
};

export type AutomationTriggerSummary = {
  index: number;
  event: string;
  schema?: AutomationSchemaSummary;
  filter?: string;
  cooldownMs: number;
  batch?: AutomationBatchSummary;
  policies: readonly AutomationPolicyGate[];
};

export type AutomationDownstreamEdge = {
  fromWorkflow: string;
  kind: "event" | "workflow";
  target: string;
  consumers: readonly string[];
  stepId?: string;
};

export type AutomationWorkflowNode = {
  name: string;
  definitionPath: string;
  enabled: boolean;
  triggers: readonly AutomationTriggerSummary[];
  steps: readonly StepSummary[];
  effects: readonly AutomationEffectSummary[];
  policyGates: readonly AutomationPolicyGate[];
  blockers: readonly AutomationBlocker[];
  downstream: readonly AutomationDownstreamEdge[];
};

export type AutomationEventNode = EventNode & {
  schema?: AutomationSchemaSummary;
  consumers: string[];
  producers: string[];
};

export type CompiledAutomationGraph = WorkflowGraph & {
  automation: {
    workflows: readonly AutomationWorkflowNode[];
    events: readonly AutomationEventNode[];
    blockers: readonly AutomationBlocker[];
    downstream: readonly AutomationDownstreamEdge[];
  };
};

export type AutomationExplainOutcome =
  | "queued"
  | "batched"
  | "blocked"
  | "dead-letter"
  | "ignored"
  | "no-op"
  | "unknown";

export type AutomationExplainReason = {
  code: string;
  severity: "info" | "warning" | "blocker";
  message: string;
  workflow?: string;
  event?: string;
  triggerIndex?: number;
  stepId?: string;
};

export type AutomationExplainSampleEvent = {
  event: string;
  payload: WorkflowRunTrigger["payload"];
  eventId?: string;
};

export type AutomationExplainOptions = {
  workflowName?: string;
  eventName?: string;
  sampleEvent?: AutomationExplainSampleEvent;
};

export type AutomationExplainQuerySampleEvent = {
  event: string;
  eventId?: string;
  hasPayload: boolean;
};

export type AutomationExplainQuery = {
  workflowName?: string;
  eventName?: string;
  sampleEvent?: AutomationExplainQuerySampleEvent;
};

export type AutomationExplainWorkflowMatch = {
  workflow: string;
  triggerIndex: number;
  triggerEvent: string;
  matchedFilter: boolean;
  batch?: AutomationBatchSummary;
  effects: readonly AutomationEffectSummary[];
  blockers: readonly AutomationBlocker[];
  downstream: readonly AutomationDownstreamEdge[];
};

export type AutomationExplainResult = {
  graph: CompiledAutomationGraph;
  query: AutomationExplainQuery;
  outcome: AutomationExplainOutcome;
  matches: readonly AutomationExplainWorkflowMatch[];
  reasons: readonly AutomationExplainReason[];
  redactedSamplePayload?: EvidenceJsonObject;
};
