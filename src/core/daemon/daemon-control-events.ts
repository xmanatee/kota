import type { BusEvents } from "#core/events/event-bus-types.js";

/** Operator queue invalidation synthesized from workflow lifecycle events. */
export type QueueChangedPayload =
  | { source: "workflow.started"; workflow: string }
  | {
      source: "workflow.completed";
      workflow: string;
      status: BusEvents["workflow.completed"]["status"];
    };

/** Typed daemon SSE broadcasts. */
export type DaemonSseEvent =
  | { type: "workflow.started"; payload: BusEvents["workflow.started"] }
  | { type: "workflow.completed"; payload: BusEvents["workflow.completed"] }
  | { type: "workflow.step.completed"; payload: BusEvents["workflow.step.completed"] }
  | { type: "daemon.config.reload"; payload: BusEvents["daemon.config.reload"] }
  | { type: "scope.lifecycle.changed"; payload: BusEvents["scope.lifecycle.changed"] }
  | { type: "queue.changed"; payload: QueueChangedPayload }
  | { type: "approval.changed"; payload: BusEvents["approval.changed"] }
  | { type: "task.changed"; payload: BusEvents["task.changed"] }
  | { type: "session.registered"; payload: BusEvents["session.registered"] }
  | { type: "session.unregistered"; payload: BusEvents["session.unregistered"] }
  | { type: "owner.question.asked"; payload: BusEvents["owner.question.asked"] }
  | { type: "owner.question.changed"; payload: BusEvents["owner.question.changed"] }
  | { type: "owner.question.resolved"; payload: BusEvents["owner.question.resolved"] }
  | { type: "owner.question.dismissed"; payload: BusEvents["owner.question.dismissed"] }
  | { type: "owner.question.expired"; payload: BusEvents["owner.question.expired"] };

export type DaemonSseEventType = DaemonSseEvent["type"];

export type DaemonSseStreamEvent = DaemonSseEvent & {
  /** Opaque, daemon-local event id used as the reconnect cursor. */
  id: string;
};

export type DaemonTimelineEvent = DaemonSseStreamEvent & {
  /** ISO timestamp for human-facing ordering and timestamp catch-up. */
  timestamp: string;
};
