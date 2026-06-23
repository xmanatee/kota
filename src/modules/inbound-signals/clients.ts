import type { ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  InboundSignalProjectSelection,
  InboundSignalsClient,
} from "./client.js";
import { buildRoutingStatus } from "./module-routing.js";
import type { InboundSignalRoutingStatus } from "./routing.js";

export function buildInboundSignalsLocalClient(ctx: ModuleContext): InboundSignalsClient {
  return {
    async listRoutes(project?: InboundSignalProjectSelection) {
      return buildRoutingStatus(ctx, project?.projectId);
    },
    async validateRoutes(project?: InboundSignalProjectSelection) {
      return buildRoutingStatus(ctx, project?.projectId).validation;
    },
  };
}

function query(project?: InboundSignalProjectSelection): string {
  if (!project?.projectId) return "";
  const params = new URLSearchParams();
  params.set("projectId", project.projectId);
  return `?${params.toString()}`;
}

export function buildInboundSignalsDaemonClient(
  link: DaemonTransport,
): InboundSignalsClient {
  return {
    async listRoutes(project?: InboundSignalProjectSelection) {
      const result = await link.request<InboundSignalRoutingStatus>(
        "GET",
        `/inbound-signals/routes${query(project)}`,
      );
      if (!result) {
        throw new Error("Daemon unreachable while listing inbound signal routes");
      }
      return result;
    },
    async validateRoutes(project?: InboundSignalProjectSelection) {
      return (await this.listRoutes(project)).validation;
    },
  };
}
