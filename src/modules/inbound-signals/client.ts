import type { ScopeSelector } from "#core/server/scope-selector.js";
import type {
  InboundSignalRouteValidationResult,
  InboundSignalRoutingStatus,
} from "./routing.js";

export type {
  InboundSignalRouteValidationResult,
  InboundSignalRoutingStatus,
};

export type InboundSignalScopeSelection = ScopeSelector;

export type InboundSignalRouteListResult = InboundSignalRoutingStatus;

export type InboundSignalsClient = {
  listRoutes(
    scopeSelector?: InboundSignalScopeSelection,
  ): Promise<InboundSignalRouteListResult>;
  validateRoutes(
    scopeSelector?: InboundSignalScopeSelection,
  ): Promise<InboundSignalRouteValidationResult>;
};
