import type { ScopeSelector } from "#core/server/scope-selector.js";
import type {
  InboundSignalRouteValidationResult,
  InboundSignalRoutingStatus,
} from "./routing.js";

export type InboundSignalProjectSelection = ScopeSelector;

export type InboundSignalRouteListResult = InboundSignalRoutingStatus;

export type InboundSignalsClient = {
  listRoutes(
    project?: InboundSignalProjectSelection,
  ): Promise<InboundSignalRouteListResult>;
  validateRoutes(
    project?: InboundSignalProjectSelection,
  ): Promise<InboundSignalRouteValidationResult>;
};
