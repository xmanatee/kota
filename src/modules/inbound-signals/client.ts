import type {
  InboundSignalRouteValidationResult,
  InboundSignalRoutingStatus,
} from "./routing.js";

export type InboundSignalProjectSelection = {
  projectId?: string;
};

export type InboundSignalRouteListResult = InboundSignalRoutingStatus;

export type InboundSignalsClient = {
  listRoutes(
    project?: InboundSignalProjectSelection,
  ): Promise<InboundSignalRouteListResult>;
  validateRoutes(
    project?: InboundSignalProjectSelection,
  ): Promise<InboundSignalRouteValidationResult>;
};
