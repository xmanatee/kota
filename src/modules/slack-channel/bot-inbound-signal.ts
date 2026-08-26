import type { SlackInboundSignalRuntime } from "./bot-options.js";
import type { SlackEventsApiPayload, SlackMessageEvent } from "./client.js";
import { emitSlackTextInboundSignal } from "./inbound-signal.js";

export function consumeSlackInboundSignal(
	inboundSignals: SlackInboundSignalRuntime | undefined,
	event: SlackMessageEvent,
	envelope: SlackEventsApiPayload,
): boolean {
	if (!inboundSignals) return false;
	const result = emitSlackTextInboundSignal(
		inboundSignals.events,
		event,
		envelope,
		{
			scopeId: inboundSignals.getScopeId(),
			receivedAt: new Date().toISOString(),
			config: inboundSignals.config,
		},
	);
	if (result.emitted) return result.consumed;
	if ("error" in result) {
		throw new Error(`Slack inbound signal is invalid: ${result.error}`);
	}
	return false;
}
