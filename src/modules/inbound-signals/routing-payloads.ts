import type { WorkflowTriggerOptions } from "#modules/workflow-ops/client.js";
import type {
  InboundSignalJsonObject,
  InboundSignalReceivedPayload,
  InboundSignalRouteDecision,
  InboundSignalRoutedPayload,
  InboundSignalRoutePolicyPayload,
  InboundSignalRouteTargetResult,
  InboundSignalSourceStatus,
} from "./events.js";
import { batchPolicyJson, processingPolicyJson } from "./routing-batch.js";
import { DEFAULT_ROUTE_ID } from "./routing-constants.js";
import type {
  InboundSignalAgentRouteTargetConfig,
  InboundSignalRouteConfig,
  InboundSignalRouteTargetConfig,
} from "./routing-types.js";

export function policyPayload(
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

export function skippedTargets(
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

export function routedPayload(args: {
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

export function workflowTriggerPayload(args: {
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

export function agentTriggerPayload(args: {
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

export function agentTargetAutonomyMode(
  route: InboundSignalRouteConfig,
): "passive" | "autonomous" {
  return route.processing?.allowNonReadActions === true ? "autonomous" : "passive";
}
