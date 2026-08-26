import { Command } from "commander";
import type { KotaModule } from "#core/modules/module-types.js";
import { WORKFLOW_EVENT_DISPATCHER_PROVIDER_TYPE } from "#core/workflow/workflow-event-dispatcher-provider.js";
import { triggerInboundSignalAgent } from "./agent-trigger.js";
import { buildInboundSignalsCommand } from "./cli.js";
import {
  buildInboundSignalsDaemonClient,
  buildInboundSignalsLocalClient,
} from "./clients.js";
import { inboundSignalsConfigSchema } from "./config-schema.js";
import {
  inboundSignalReceived,
  inboundSignalRouted,
} from "./events.js";
import {
  buildRoutingStatus,
  effectiveRoutingConfig,
  routingValidationContext,
} from "./module-routing.js";
import {
  inboundSignalRouteStatusControlRoutes,
  inboundSignalRouteStatusRoutes,
} from "./routes.js";
import { dispatchInboundSignalRoute } from "./routing.js";

export * from "./events.js";
export * from "./routing.js";

const inboundSignalsModule: KotaModule = {
  name: "inbound-signals",
  version: "1.0.0",
  description:
    "Typed scope-bound inbound external signal contract and routing dispatcher for workflow automation",
  dependencies: ["rendering", "workflow-ops"],
  events: [inboundSignalReceived, inboundSignalRouted],
  commands: (ctx) => {
    const root = new Command("__root__");
    root.addCommand(buildInboundSignalsCommand(ctx));
    return [...root.commands];
  },
  routes: (ctx) => inboundSignalRouteStatusRoutes((scopeId) =>
    buildRoutingStatus(ctx, scopeId)
  ),
  controlRoutes: (ctx) => inboundSignalRouteStatusControlRoutes((scopeId) =>
    buildRoutingStatus(ctx, scopeId)
  ),
  localClient: (ctx) => ({
    inboundSignals: buildInboundSignalsLocalClient(ctx),
  }),
  daemonClient: (link) => ({
    inboundSignals: buildInboundSignalsDaemonClient(link),
  }),
  onLoad: (ctx) => {
    const unsubscribe = ctx.events.subscribe(
      inboundSignalReceived,
      (signal) => {
        const context = routingValidationContext(ctx);
        void dispatchInboundSignalRoute({
          config: effectiveRoutingConfig(ctx, context),
          signal,
          context,
          deps: {
            triggerWorkflow: (name, options) =>
              ctx.client.workflow.triggerByName(name, options),
            batchWorkflow: (input) => {
              const dispatcher = ctx.getProvider(WORKFLOW_EVENT_DISPATCHER_PROVIDER_TYPE);
              if (!dispatcher) {
                return {
                  ok: false,
                  reason: "unknown_workflow",
                  message: "workflow event dispatcher is unavailable",
                };
              }
              return dispatcher.enqueueBatchedEvent(input);
            },
            triggerAgent: (name, options) =>
              triggerInboundSignalAgent(ctx, name, options),
            emitRouted: (payload) => ctx.events.emit(inboundSignalRouted, payload),
          },
        }).catch((err) => {
          ctx.log.error(
            `inbound-signals route dispatch failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      },
    );
    return { dispose: unsubscribe };
  },
  configSchema: inboundSignalsConfigSchema,
};

export default inboundSignalsModule;
