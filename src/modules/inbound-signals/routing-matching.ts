import type { InboundSignalReceivedPayload } from "./events.js";
import type {
  InboundSignalRouteConfig,
  InboundSignalRouteOutcomeBase,
  InboundSignalRouteValidationContext,
  InboundSignalRoutingConfig,
} from "./routing-types.js";
import { validateInboundSignalRoutingConfig } from "./routing-validation.js";

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

export function selectInboundSignalRouteOutcome(
  config: InboundSignalRoutingConfig,
  signal: InboundSignalReceivedPayload,
  context: InboundSignalRouteValidationContext,
): InboundSignalRouteOutcomeBase {
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
