import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  InboundSignalScopeSelection,
  InboundSignalsClient,
} from "./client.js";
import { buildRoutingStatus } from "./module-routing.js";

export function buildInboundSignalsLocalClient(ctx: ModuleContext): InboundSignalsClient {
  return {
    async listRoutes(scopeSelector?: InboundSignalScopeSelection) {
      return buildRoutingStatus(ctx, scopeSelector?.scopeId);
    },
    async validateRoutes(scopeSelector?: InboundSignalScopeSelection) {
      return buildRoutingStatus(ctx, scopeSelector?.scopeId).validation;
    },
  };
}
