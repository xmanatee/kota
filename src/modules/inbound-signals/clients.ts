import type { ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  InboundSignalScopeSelection,
  InboundSignalsClient,
} from "./client.js";
import { buildRoutingStatus } from "./module-routing.js";
import type { InboundSignalRoutingStatus } from "./routing.js";

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

function query(scopeSelector?: InboundSignalScopeSelection): string {
  if (!scopeSelector?.scopeId) return "";
  const params = new URLSearchParams();
  params.set("scopeId", scopeSelector.scopeId);
  return `?${params.toString()}`;
}

export function buildInboundSignalsDaemonClient(
  link: DaemonTransport,
): InboundSignalsClient {
  return {
    async listRoutes(scopeSelector?: InboundSignalScopeSelection) {
      const result = await link.request<InboundSignalRoutingStatus>(
        "GET",
        `/inbound-signals/routes${query(scopeSelector)}`,
      );
      if (!result) {
        throw new Error("Daemon unreachable while listing inbound signal routes");
      }
      return result;
    },
    async validateRoutes(scopeSelector?: InboundSignalScopeSelection) {
      return (await this.listRoutes(scopeSelector)).validation;
    },
  };
}
