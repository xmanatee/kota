import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import type {
  ChannelOpportunityBatchInput,
  RoutedInboundSignalPayload,
} from "./matching-types.js";

export function readChannelOpportunityBatch(
  payload: WorkflowBatchFlushPayload,
): ChannelOpportunityBatchInput {
  return {
    scopeId: payload.scopeId,
    sourceEventName: payload.sourceEventName,
    groupingKey: payload.groupingKey,
    flushReason: payload.reason,
    count: payload.count,
    droppedInputCount: payload.batch.droppedInputCount,
    signals: payload.inputEvents.map((event) => {
      const routed = event.payload as RoutedInboundSignalPayload;
      return {
        routeId: routed.routeId,
        sourceStatus: routed.sourceStatus,
        provider: routed.provider,
        channel: routed.channel,
        accountId: routed.accountId,
        sourceId: routed.sourceId,
        actorTrust: routed.actorTrust,
        signal: routed.signal,
      };
    }),
  };
}
