import { batchPolicyJson, processingPolicyJson } from "./routing-batch.js";
import type {
  InboundSignalRouteConfig,
  InboundSignalRouteProjection,
  InboundSignalRouteValidationContext,
  InboundSignalRoutingConfig,
  InboundSignalRoutingStatus,
} from "./routing-types.js";
import { validateInboundSignalRoutingConfig } from "./routing-validation.js";

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
