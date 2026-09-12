import type { EventBus } from "#core/events/event-bus.js";
import type { BusEvents } from "#core/events/event-bus-types.js";

/** Operator queue invalidation synthesized from workflow lifecycle events. */
export type QueueChangedPayload =
	| { scopeId: string; source: "workflow.started"; workflow: string }
	| {
			scopeId: string;
			source: "workflow.completed";
			workflow: string;
			status: BusEvents["workflow.completed"]["status"];
	  };

/** Direct bus events exposed by the daemon control stream. */
const FORWARDED_EVENTS = [
	"schedule.fire",
	"workflow.started",
	"workflow.completed",
	"workflow.step.completed",
	"daemon.config.reload",
	"scope.lifecycle.changed",
	"approval.changed",
	"task.changed",
	"session.registered",
	"session.unregistered",
	"owner.question.asked",
	"owner.question.changed",
	"owner.question.resolved",
	"owner.question.dismissed",
	"owner.question.expired",
] as const satisfies readonly (keyof BusEvents)[];

type ForwardedEventType = (typeof FORWARDED_EVENTS)[number];
type ForwardedEvent = {
	[K in ForwardedEventType]: { type: K; payload: BusEvents[K] };
}[ForwardedEventType];

export type DaemonSseEvent =
	| ForwardedEvent
	| { type: "queue.changed"; payload: QueueChangedPayload };

export function subscribeToDaemonEvents(
	bus: EventBus,
	handler: (event: DaemonSseEvent) => void,
): () => void {
	const stops = FORWARDED_EVENTS.map((type) =>
		bus.on(type, (payload) => {
			// The bus correlates each payload with its subscribed type.
			const event = { type, payload } as ForwardedEvent;
			handler(event);
			if (event.type === "workflow.started") {
				handler({
					type: "queue.changed",
					payload: { scopeId: event.payload.scopeId, source: event.type, workflow: event.payload.workflow },
				});
			} else if (event.type === "workflow.completed") {
				handler({
					type: "queue.changed",
					payload: {
						scopeId: event.payload.scopeId,
						source: event.type,
						workflow: event.payload.workflow,
						status: event.payload.status,
					},
				});
			}
		}),
	);
	return () => stops.forEach((stop) => stop());
}

export type DaemonSseEventType = DaemonSseEvent["type"];

export type DaemonSseStreamEvent = DaemonSseEvent & {
	/** Opaque, daemon-local event id used as the reconnect cursor. */
	id: string;
};

export type DaemonTimelineEvent = DaemonSseStreamEvent & {
	/** ISO timestamp for human-facing ordering and timestamp catch-up. */
	timestamp: string;
};

/** Only events whose declared payload is daemon-wide may omit attribution. */
export type DaemonWideSseEventType = Exclude<
  DaemonSseEvent,
  { payload: { scopeId: string } }
>["type"];

const daemonWideEvents = {
  "daemon.config.reload": true,
  "scope.lifecycle.changed": true,
} satisfies Record<DaemonWideSseEventType, true>;

export function daemonEventMatchesScope(event: DaemonSseEvent, scopeId: string | null): boolean {
  if (scopeId === null) return true;
  if ("scopeId" in event.payload) return event.payload.scopeId === scopeId;
  return Object.hasOwn(daemonWideEvents, event.type);
}
