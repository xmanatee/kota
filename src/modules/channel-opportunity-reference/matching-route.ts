import type { InboundSignalRouteConfig } from "#modules/inbound-signals/routing.js";
import {
  CHANNEL_OPPORTUNITY_REFERENCE_ROUTE_ID,
  CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
} from "./matching-types.js";

export function referenceTelegramSportsRouteConfig(): InboundSignalRouteConfig {
  return {
    id: CHANNEL_OPPORTUNITY_REFERENCE_ROUTE_ID,
    provider: "telegram",
    channel: "telegram.group",
    sourceId: "telegram:redacted-sports-community",
    actorTrust: "trusted",
    targets: [
      {
        kind: "workflow",
        name: CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
        batch: {
          mode: "workflow-trigger",
          maxItems: 6,
          idleMs: 5 * 60 * 1000,
          maxBufferSize: 30,
          overflow: "flush-oldest",
          groupBy: ["channel", "sourceId"],
        },
      },
    ],
    processing: {
      classifier: "cheap",
      modelTier: "capable",
      allowNonReadActions: true,
    },
  };
}
