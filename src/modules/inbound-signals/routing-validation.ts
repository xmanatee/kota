import { isNonEmpty, MATCH_FIELDS, routeLabel } from "./routing-constants.js";
import type {
  InboundSignalBatchPolicy,
  InboundSignalRouteConfig,
  InboundSignalRouteMatchField,
  InboundSignalRouteValidationContext,
  InboundSignalRouteValidationError,
  InboundSignalRouteValidationResult,
  InboundSignalRoutingConfig,
} from "./routing-types.js";

function validateRouteId(
  route: InboundSignalRouteConfig,
  seenIds: Set<string>,
  errors: InboundSignalRouteValidationError[],
): void {
  if (!isNonEmpty(route.id)) {
    errors.push({ routeId: routeLabel(route), message: "id must be a non-empty string" });
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
      routeId: routeLabel(route),
      message: `${field} must be a non-empty string when provided`,
    });
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
      routeId: routeLabel(route),
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
        routeId: routeLabel(route),
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
      routeId: routeLabel(route),
      message: `${owner} must set at least one of maxItems, maxAgeMs, or idleMs`,
    });
  }
  if (
    batch.maxItems !== undefined &&
    batch.maxBufferSize !== undefined &&
    batch.maxItems > batch.maxBufferSize
  ) {
    errors.push({
      routeId: routeLabel(route),
      message: `${owner}.maxItems must be <= ${owner}.maxBufferSize`,
    });
  }
  if (
    batch.overflow !== undefined &&
    batch.overflow !== "drop-newest" &&
    batch.overflow !== "flush-oldest"
  ) {
    errors.push({
      routeId: routeLabel(route),
      message: `${owner}.overflow must be drop-newest or flush-oldest`,
    });
  }
  for (const field of batch.groupBy ?? []) {
    if (!MATCH_FIELDS.includes(field)) {
      errors.push({
        routeId: routeLabel(route),
        message: `${owner}.groupBy field "${field}" is not a route match field`,
      });
    }
  }
}

function validateTargets(
  route: InboundSignalRouteConfig,
  context: InboundSignalRouteValidationContext,
  errors: InboundSignalRouteValidationError[],
): void {
  if (route.targets.length === 0) {
    errors.push({
      routeId: routeLabel(route),
      message: "targets must contain at least one workflow or agent target",
    });
    return;
  }
  for (const target of route.targets) {
    if (target.kind !== "workflow" && target.kind !== "agent") {
      errors.push({
        routeId: routeLabel(route),
        message: "target.kind must be workflow or agent",
      });
      continue;
    }
    if (!isNonEmpty(target.name)) {
      errors.push({
        routeId: routeLabel(route),
        message: "target.name must be a non-empty string",
      });
      continue;
    }
    if (target.kind === "workflow" && !context.workflowNames.has(target.name)) {
      errors.push({
        routeId: routeLabel(route),
        message: `target workflow "${target.name}" is not registered`,
      });
    }
    if (target.kind === "agent" && !context.agentNames.has(target.name)) {
      errors.push({
        routeId: routeLabel(route),
        message: `target agent "${target.name}" is not registered`,
      });
    }
    if (
      target.kind === "agent" &&
      (!Number.isInteger(target.maxTurns) || target.maxTurns <= 0)
    ) {
      errors.push({
        routeId: routeLabel(route),
        message: "target.maxTurns must be a positive integer for agent targets",
      });
    }
    if (target.kind === "workflow") {
      validateBatchPolicy(route, target.batch, `target "${target.name}" batch`, errors);
    } else if ("batch" in target && target.batch !== undefined) {
      errors.push({
        routeId: routeLabel(route),
        message: "target.batch is only valid for workflow targets",
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
        routeId: routeLabel(left),
        message: `route overlaps route "${routeLabel(right)}"; combine targets into one deterministic rule`,
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
        routeId: routeLabel(route),
        message: "sourceStatus must be active, blocked, archived, or ignored",
      });
    }
    if (
      route.blockedHandling !== undefined &&
      route.blockedHandling !== "audit-only" &&
      route.blockedHandling !== "dispatch"
    ) {
      errors.push({
        routeId: routeLabel(route),
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
