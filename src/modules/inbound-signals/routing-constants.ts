import type { WorkflowBatchOverflowPolicy } from "#core/workflow/trigger-types.js";
import type {
  InboundSignalRouteConfig,
  InboundSignalRouteMatchField,
} from "./routing-types.js";

export const DEFAULT_ROUTE_ID = "none";
export const DEFAULT_BATCH_MAX_BUFFER_SIZE = 100;
export const DEFAULT_BATCH_OVERFLOW: WorkflowBatchOverflowPolicy = "flush-oldest";
export const MATCH_FIELDS: readonly InboundSignalRouteMatchField[] = [
  "provider",
  "channel",
  "accountId",
  "sourceId",
  "actorTrust",
];

export function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function routeLabel(route: InboundSignalRouteConfig): string {
  return isNonEmpty(route.id) ? route.id : "(missing id)";
}
