import type {
  WorkflowBatchDispatchInput,
  WorkflowBatchDispatchResult,
} from "#core/workflow/event-batches.js";
import type {
  WorkflowBatchOverflowPolicy,
  WorkflowBatchTrigger,
} from "#core/workflow/trigger-types.js";
import type { WorkflowTriggerOptions, WorkflowTriggerResult } from "#modules/workflow-ops/client.js";
import {
  type InboundSignalActorTrust,
  type InboundSignalJsonObject,
  type InboundSignalReceivedPayload,
  type InboundSignalRouteDecision,
  type InboundSignalRoutedPayload,
  type InboundSignalRoutePolicyPayload,
  type InboundSignalRouteTargetResult,
  type InboundSignalSourceStatus,
  inboundSignalReceived,
  inboundSignalRouted,
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

type RouteOutcomeBase = {
  route: InboundSignalRouteConfig | null;
  decision: InboundSignalRouteDecision;
  sourceStatus: InboundSignalSourceStatus;
  reason: string;
};

type RouteDispatchDependency = {
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

const DEFAULT_ROUTE_ID = "none";
const DEFAULT_BATCH_MAX_BUFFER_SIZE = 100;
const DEFAULT_BATCH_OVERFLOW: WorkflowBatchOverflowPolicy = "flush-oldest";
const MATCH_FIELDS: readonly InboundSignalRouteMatchField[] = [
  "provider",
  "channel",
  "accountId",
  "sourceId",
  "actorTrust",
];

export type InboundSignalAgentTriggerOptions = {
  maxTurns: number;
  autonomyMode: "passive" | "autonomous";
  payload: InboundSignalJsonObject;
};

export type InboundSignalAgentTriggerResult =
  | { ok: true; sessionId?: string }
  | { ok: false; reason: string };

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function label(route: InboundSignalRouteConfig): string {
  return isNonEmpty(route.id) ? route.id : "(missing id)";
}

function validateRouteId(
  route: InboundSignalRouteConfig,
  seenIds: Set<string>,
  errors: InboundSignalRouteValidationError[],
): void {
  if (!isNonEmpty(route.id)) {
    errors.push({ routeId: label(route), message: "id must be a non-empty string" });
    return;
  }
  if (seenIds.has(route.id)) {
    errors.push({ routeId: route.id, message: "id must be unique" });
    return;
  }
  seenIds.add(route.id);
}

function validateStringField(
  route: InboundSignalRouteConfig,
  field: InboundSignalRouteMatchField | "scopeId",
  errors: InboundSignalRouteValidationError[],
): void {
  const value = route[field];
  if (value !== undefined && !isNonEmpty(value)) {
    errors.push({
      routeId: label(route),
      message: `${field} must be a non-empty string when provided`,
    });
  }
}

function validateTargets(
  route: InboundSignalRouteConfig,
  context: InboundSignalRouteValidationContext,
  errors: InboundSignalRouteValidationError[],
): void {
  if (route.targets.length === 0) {
    errors.push({
      routeId: label(route),
      message: "targets must contain at least one workflow or agent target",
    });
    return;
  }
  for (const target of route.targets) {
    if (target.kind !== "workflow" && target.kind !== "agent") {
      errors.push({
        routeId: label(route),
        message: "target.kind must be workflow or agent",
      });
      continue;
    }
    if (!isNonEmpty(target.name)) {
      errors.push({
        routeId: label(route),
        message: "target.name must be a non-empty string",
      });
      continue;
    }
    if (target.kind === "workflow" && !context.workflowNames.has(target.name)) {
      errors.push({
        routeId: label(route),
        message: `target workflow "${target.name}" is not registered`,
      });
    }
    if (target.kind === "agent" && !context.agentNames.has(target.name)) {
      errors.push({
        routeId: label(route),
        message: `target agent "${target.name}" is not registered`,
      });
    }
    if (
      target.kind === "agent" &&
      (!Number.isInteger(target.maxTurns) || target.maxTurns <= 0)
    ) {
      errors.push({
        routeId: label(route),
        message: "target.maxTurns must be a positive integer for agent targets",
      });
    }
    if (target.kind === "workflow") {
      validateBatchPolicy(route, target.batch, `target "${target.name}" batch`, errors);
    } else if ("batch" in target && target.batch !== undefined) {
      errors.push({
        routeId: label(route),
        message: "target.batch is only valid for workflow targets",
      });
    }
  }
}

function validateBatchPolicy(
  route: InboundSignalRouteConfig,
  batch: InboundSignalBatchPolicy | undefined,
  owner: string,
  errors: InboundSignalRouteValidationError[],
): void {
  if (!batch) return;
  if (batch.mode !== "workflow-trigger") {
    errors.push({
      routeId: label(route),
      message: `${owner}.mode must be workflow-trigger`,
    });
  }
  for (const [field, value] of [
    ["maxItems", batch.maxItems],
    ["maxAgeMs", batch.maxAgeMs],
    ["idleMs", batch.idleMs],
    ["maxBufferSize", batch.maxBufferSize],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      errors.push({
        routeId: label(route),
        message: `${owner}.${field} must be a positive integer when provided`,
      });
    }
  }
  if (
    batch.maxItems === undefined &&
    batch.maxAgeMs === undefined &&
    batch.idleMs === undefined
  ) {
    errors.push({
      routeId: label(route),
      message: `${owner} must set at least one of maxItems, maxAgeMs, or idleMs`,
    });
  }
  if (
    batch.maxItems !== undefined &&
    batch.maxBufferSize !== undefined &&
    batch.maxItems > batch.maxBufferSize
  ) {
    errors.push({
      routeId: label(route),
      message: `${owner}.maxItems must be <= ${owner}.maxBufferSize`,
    });
  }
  if (
    batch.overflow !== undefined &&
    batch.overflow !== "drop-newest" &&
    batch.overflow !== "flush-oldest"
  ) {
    errors.push({
      routeId: label(route),
      message: `${owner}.overflow must be drop-newest or flush-oldest`,
    });
  }
  for (const field of batch.groupBy ?? []) {
    if (!MATCH_FIELDS.includes(field)) {
      errors.push({
        routeId: label(route),
        message: `${owner}.groupBy field "${field}" is not a route match field`,
      });
    }
  }
}

function routesOverlap(
  a: InboundSignalRouteConfig,
  b: InboundSignalRouteConfig,
): boolean {
  for (const field of MATCH_FIELDS) {
    const left = a[field];
    const right = b[field];
    if (left !== undefined && right !== undefined && left !== right) {
      return false;
    }
  }
  return true;
}

function validateNoConflicts(
  routes: readonly InboundSignalRouteConfig[],
  errors: InboundSignalRouteValidationError[],
): void {
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const left = routes[i]!;
      const right = routes[j]!;
      if (!routesOverlap(left, right)) continue;
      errors.push({
        routeId: label(left),
        message: `route overlaps route "${label(right)}"; combine targets into one deterministic rule`,
      });
    }
  }
}

export function validateInboundSignalRoutingConfig(
  config: InboundSignalRoutingConfig,
  context: InboundSignalRouteValidationContext,
): InboundSignalRouteValidationResult {
  const routes = config.routes ?? [];
  const errors: InboundSignalRouteValidationError[] = [];
  const seenIds = new Set<string>();
  for (const route of routes) {
    validateRouteId(route, seenIds, errors);
    for (const field of MATCH_FIELDS) validateStringField(route, field, errors);
    validateStringField(route, "scopeId", errors);
    if (
      route.sourceStatus !== undefined &&
      route.sourceStatus !== "active" &&
      route.sourceStatus !== "blocked" &&
      route.sourceStatus !== "archived" &&
      route.sourceStatus !== "ignored"
    ) {
      errors.push({
        routeId: label(route),
        message: "sourceStatus must be active, blocked, archived, or ignored",
      });
    }
    if (
      route.blockedHandling !== undefined &&
      route.blockedHandling !== "audit-only" &&
      route.blockedHandling !== "dispatch"
    ) {
      errors.push({
        routeId: label(route),
        message: "blockedHandling must be audit-only or dispatch",
      });
    }
    validateTargets(route, context, errors);
    validateBatchPolicy(route, route.batch, "batch", errors);
  }
  validateNoConflicts(routes, errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, routes };
}

function batchPolicyJson(
  batch: InboundSignalBatchPolicy | undefined,
): InboundSignalJsonObject | null {
  if (!batch) return null;
  const out: {
    mode: "workflow-trigger";
    maxItems?: number;
    maxAgeMs?: number;
    idleMs?: number;
    maxBufferSize: number;
    overflow: WorkflowBatchOverflowPolicy;
    groupBy?: readonly InboundSignalRouteMatchField[];
  } = {
    mode: batch.mode,
    maxBufferSize: effectiveMaxBufferSize(batch),
    overflow: batch.overflow ?? DEFAULT_BATCH_OVERFLOW,
  };
  if (batch.maxItems !== undefined) out.maxItems = batch.maxItems;
  if (batch.maxAgeMs !== undefined) out.maxAgeMs = batch.maxAgeMs;
  if (batch.idleMs !== undefined) out.idleMs = batch.idleMs;
  if (batch.groupBy !== undefined) out.groupBy = batch.groupBy;
  return out;
}

function effectiveMaxBufferSize(batch: InboundSignalBatchPolicy): number {
  if (batch.maxBufferSize !== undefined) return batch.maxBufferSize;
  return Math.max(batch.maxItems ?? 0, DEFAULT_BATCH_MAX_BUFFER_SIZE);
}

function workflowBatchTrigger(batch: InboundSignalBatchPolicy): WorkflowBatchTrigger {
  return {
    ...(batch.maxItems !== undefined ? { maxCount: batch.maxItems } : {}),
    ...(batch.maxAgeMs !== undefined ? { maxAgeMs: batch.maxAgeMs } : {}),
    ...(batch.idleMs !== undefined ? { idleTimeoutMs: batch.idleMs } : {}),
    groupBy: batch.groupBy ?? [],
    maxBufferSize: effectiveMaxBufferSize(batch),
    overflow: batch.overflow ?? DEFAULT_BATCH_OVERFLOW,
  };
}

function processingPolicyJson(
  processing: InboundSignalProcessingPolicy | undefined,
): InboundSignalJsonObject | null {
  if (!processing) return null;
  const out: {
    classifier?: "none" | "cheap";
    modelTier?: "fast" | "balanced" | "capable";
    allowNonReadActions?: boolean;
  } = {};
  if (processing.classifier !== undefined) out.classifier = processing.classifier;
  if (processing.modelTier !== undefined) out.modelTier = processing.modelTier;
  if (processing.allowNonReadActions !== undefined) {
    out.allowNonReadActions = processing.allowNonReadActions;
  }
  return out;
}

export function projectRouteStatus(
  route: InboundSignalRouteConfig,
): InboundSignalRouteProjection {
  return {
    id: route.id,
    provider: route.provider ?? "*",
    channel: route.channel ?? "*",
    accountId: route.accountId ?? "*",
    sourceId: route.sourceId ?? "*",
    actorTrust: route.actorTrust ?? "*",
    scopeId: route.scopeId ?? "(signal scope)",
    sourceStatus: route.sourceStatus ?? "active",
    blockedHandling: route.blockedHandling ?? "audit-only",
    targets: route.targets,
    batch: batchPolicyJson(route.batch),
    processing: processingPolicyJson(route.processing),
  };
}

export function inboundSignalRoutingStatus(
  config: InboundSignalRoutingConfig,
  context: InboundSignalRouteValidationContext,
): InboundSignalRoutingStatus {
  const validation = validateInboundSignalRoutingConfig(config, context);
  const routes = validation.ok ? validation.routes : config.routes ?? [];
  return {
    routes: routes.map(projectRouteStatus),
    validation,
  };
}

function routeMatchesSignal(
  route: InboundSignalRouteConfig,
  signal: InboundSignalReceivedPayload,
): boolean {
  return (
    (route.provider === undefined || route.provider === signal.provider) &&
    (route.channel === undefined || route.channel === signal.channel) &&
    (route.accountId === undefined || route.accountId === signal.accountId) &&
    (route.sourceId === undefined || route.sourceId === signal.sourceId) &&
    (route.actorTrust === undefined || route.actorTrust === signal.actor.trust)
  );
}

function selectOutcome(
  config: InboundSignalRoutingConfig,
  signal: InboundSignalReceivedPayload,
  context: InboundSignalRouteValidationContext,
): RouteOutcomeBase {
  const validation = validateInboundSignalRoutingConfig(config, context);
  if (!validation.ok) {
    return {
      route: null,
      decision: "validation-error",
      sourceStatus: "ignored",
      reason: validation.errors.map((error) => `${error.routeId}: ${error.message}`).join("; "),
    };
  }

  const route = validation.routes.find((candidate) =>
    routeMatchesSignal(candidate, signal)
  );
  if (!route) {
    return {
      route: null,
      decision: "no-route",
      sourceStatus: signal.actor.trust === "blocked" ? "blocked" : "ignored",
      reason: "no configured inbound route matched the signal",
    };
  }

  const sourceStatus =
    route.sourceStatus ?? (signal.actor.trust === "blocked" ? "blocked" : "active");
  const blockedHandling = route.blockedHandling ?? "audit-only";
  if (sourceStatus !== "active" && blockedHandling !== "dispatch") {
    return {
      route,
      decision: sourceStatus,
      sourceStatus,
      reason: `source status is ${sourceStatus}; route is audit-only`,
    };
  }
  if (signal.actor.trust === "blocked" && blockedHandling !== "dispatch") {
    return {
      route,
      decision: "blocked",
      sourceStatus: "blocked",
      reason: "actor trust is blocked; route is audit-only",
    };
  }
  return {
    route,
    decision: "dispatched",
    sourceStatus,
    reason: "route matched active source",
  };
}

function policyPayload(
  route: InboundSignalRouteConfig | null,
  sourceStatus: InboundSignalSourceStatus,
): InboundSignalRoutePolicyPayload {
  return {
    routeId: route?.id ?? DEFAULT_ROUTE_ID,
    sourceStatus,
    blockedHandling: route?.blockedHandling ?? "audit-only",
    batch: batchPolicyJson(route?.batch),
    processing: processingPolicyJson(route?.processing),
  };
}

function skippedTargets(
  route: InboundSignalRouteConfig | null,
  reason: string,
): readonly InboundSignalRouteTargetResult[] {
  return (route?.targets ?? []).map((target) => ({
    kind: target.kind,
    name: target.name,
    status: "skipped",
    reason,
  }));
}

function routedPayload(args: {
  signal: InboundSignalReceivedPayload;
  route: InboundSignalRouteConfig | null;
  decision: InboundSignalRouteDecision;
  sourceStatus: InboundSignalSourceStatus;
  targets: readonly InboundSignalRouteTargetResult[];
  reason: string;
}): InboundSignalRoutedPayload {
  const scopeId = args.route?.scopeId ?? args.signal.scopeId;
  return {
    scopeId,
    projectId: scopeId,
    routeId: args.route?.id ?? DEFAULT_ROUTE_ID,
    decision: args.decision,
    sourceStatus: args.sourceStatus,
    provider: args.signal.provider,
    channel: args.signal.channel,
    accountId: args.signal.accountId,
    sourceId: args.signal.sourceId,
    actorTrust: args.signal.actor.trust,
    policy: policyPayload(args.route, args.sourceStatus),
    signal: args.signal,
    targets: args.targets,
    reason: args.reason,
  };
}

function workflowTriggerPayload(args: {
  signal: InboundSignalReceivedPayload;
  route: InboundSignalRouteConfig;
  target: InboundSignalRouteTargetConfig;
  sourceStatus: InboundSignalSourceStatus;
}): NonNullable<WorkflowTriggerOptions["payload"]> {
  const scopeId = args.route.scopeId ?? args.signal.scopeId;
  return {
    scopeId,
    projectId: scopeId,
    routeId: args.route.id,
    decision: "dispatched",
    sourceStatus: args.sourceStatus,
    provider: args.signal.provider,
    channel: args.signal.channel,
    accountId: args.signal.accountId,
    sourceId: args.signal.sourceId,
    actorTrust: args.signal.actor.trust,
    policy: policyPayload(args.route, args.sourceStatus),
    signal: args.signal,
    target: args.target,
  };
}

function agentTriggerPayload(args: {
  signal: InboundSignalReceivedPayload;
  route: InboundSignalRouteConfig;
  target: InboundSignalAgentRouteTargetConfig;
  sourceStatus: InboundSignalSourceStatus;
}): InboundSignalJsonObject {
  const scopeId = args.route.scopeId ?? args.signal.scopeId;
  return {
    scopeId,
    projectId: scopeId,
    routeId: args.route.id,
    decision: "dispatched",
    sourceStatus: args.sourceStatus,
    provider: args.signal.provider,
    channel: args.signal.channel,
    accountId: args.signal.accountId,
    sourceId: args.signal.sourceId,
    actorTrust: args.signal.actor.trust,
    policy: policyPayload(args.route, args.sourceStatus),
    signal: args.signal,
    target: args.target,
  };
}

function agentTargetAutonomyMode(
  route: InboundSignalRouteConfig,
): "passive" | "autonomous" {
  return route.processing?.allowNonReadActions === true ? "autonomous" : "passive";
}

function workflowTargetBatch(
  route: InboundSignalRouteConfig,
  target: InboundSignalWorkflowRouteTargetConfig,
): InboundSignalBatchPolicy | undefined {
  return target.batch ?? route.batch;
}

async function dispatchAgentTarget(
  route: InboundSignalRouteConfig,
  signal: InboundSignalReceivedPayload,
  target: InboundSignalAgentRouteTargetConfig,
  sourceStatus: InboundSignalSourceStatus,
  deps: RouteDispatchDependency,
): Promise<InboundSignalRouteTargetResult> {
  if (!deps.triggerAgent) {
    return {
      kind: target.kind,
      name: target.name,
      status: "failed",
      reason: "agent route target dispatch dependency is unavailable",
    };
  }
  try {
    const result = await deps.triggerAgent(target.name, {
      maxTurns: target.maxTurns,
      autonomyMode: agentTargetAutonomyMode(route),
      payload: agentTriggerPayload({ signal, route, target, sourceStatus }),
    });
    if (!result.ok) {
      return {
        kind: target.kind,
        name: target.name,
        status: "failed",
        reason: result.reason,
      };
    }
    return {
      kind: target.kind,
      name: target.name,
      status: "completed",
      ...(result.sessionId !== undefined && { sessionId: result.sessionId }),
    };
  } catch (err) {
    return {
      kind: target.kind,
      name: target.name,
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function dispatchTargets(
  route: InboundSignalRouteConfig,
  signal: InboundSignalReceivedPayload,
  sourceStatus: InboundSignalSourceStatus,
  deps: RouteDispatchDependency,
): Promise<readonly InboundSignalRouteTargetResult[]> {
  const results: InboundSignalRouteTargetResult[] = [];
  for (const target of route.targets) {
    if (target.kind === "agent") {
      results.push(await dispatchAgentTarget(route, signal, target, sourceStatus, deps));
      continue;
    }
    const batch = workflowTargetBatch(route, target);
    if (batch) {
      if (!deps.batchWorkflow) {
        results.push({
          kind: target.kind,
          name: target.name,
          status: "failed",
          reason: "workflow batch dispatch dependency is unavailable",
        });
        continue;
      }
      try {
        const result = await deps.batchWorkflow({
          workflowName: target.name,
          event: inboundSignalReceived.name,
          schemaRef: null,
          payload: workflowTriggerPayload({ signal, route, target, sourceStatus }),
          batch: workflowBatchTrigger(batch),
        });
        if (result.ok) {
          results.push({
            kind: target.kind,
            name: target.name,
            status: result.status === "queued" ? "queued" : "batched",
          });
        } else {
          results.push({
            kind: target.kind,
            name: target.name,
            status: "failed",
            reason: result.message,
          });
        }
      } catch (err) {
        results.push({
          kind: target.kind,
          name: target.name,
          status: "failed",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }
    try {
      const result = await deps.triggerWorkflow(target.name, {
        event: inboundSignalRouted.name,
        payload: workflowTriggerPayload({ signal, route, target, sourceStatus }),
      });
      if (result.ok) {
        results.push({
          kind: target.kind,
          name: target.name,
          status: "queued",
          ...(result.runId !== undefined && { runId: result.runId }),
        });
      } else {
        results.push({
          kind: target.kind,
          name: target.name,
          status: "already-queued",
          reason: "workflow already has a pending run",
        });
      }
    } catch (err) {
      results.push({
        kind: target.kind,
        name: target.name,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export async function dispatchInboundSignalRoute(args: {
  config: InboundSignalRoutingConfig;
  signal: InboundSignalReceivedPayload;
  context: InboundSignalRouteValidationContext;
  deps: RouteDispatchDependency;
}): Promise<InboundSignalRoutedPayload> {
  const outcome = selectOutcome(args.config, args.signal, args.context);
  if (!outcome.route || outcome.decision !== "dispatched") {
    const payload = routedPayload({
      signal: args.signal,
      route: outcome.route,
      decision: outcome.decision,
      sourceStatus: outcome.sourceStatus,
      targets: skippedTargets(outcome.route, outcome.reason),
      reason: outcome.reason,
    });
    args.deps.emitRouted(payload);
    return payload;
  }

  const targets = await dispatchTargets(
    outcome.route,
    args.signal,
    outcome.sourceStatus,
    args.deps,
  );
  const payload = routedPayload({
    signal: args.signal,
    route: outcome.route,
    decision: "dispatched",
    sourceStatus: outcome.sourceStatus,
    targets,
    reason: outcome.reason,
  });
  args.deps.emitRouted(payload);
  return payload;
}
