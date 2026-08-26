import type { ScopedBusEventPayload } from "#core/events/event-bus-types.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import type { ModuleEventProxy } from "#core/modules/module-types.js";
import {
  type DeadLetterItem,
  type DeadLetterQueueRecordInput,
  DeadLetterQueueStore,
  type DeadLetterRedriveAttempt,
  deadLetterWorkflowName,
} from "./dead-letter-queue.js";
import { deriveDirectoryScopeId } from "./scope-registry.js";

export function deadLetterChangedEventPayload(
  item: DeadLetterItem,
): ScopedBusEventPayload<"workflow.dead-letter.changed"> {
  const successfulRedrive = [...item.redriveAttempts]
    .reverse()
    .find((attempt) => attempt.result.status !== "failed");
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    owningModule: item.owningModule,
    affectedWorkflowNames: [...item.affectedWorkflowNames],
    workflowName: deadLetterWorkflowName(item) ?? null,
    failureClass: item.failure.lastErrorClass,
    failureReason: item.failure.reason,
    resolutionReason: item.status === "dismissed"
      ? item.dismissalReason ?? null
      : item.status === "redriven"
      ? successfulRedrive?.reason ?? null
      : null,
    retryCount: item.failure.retryCount,
    updatedAt: item.updatedAt,
  };
}

export type DeadLetterChangedPublisher = (
  payload: ScopedBusEventPayload<"workflow.dead-letter.changed">,
) => void;

export function scopedDeadLetterChangedPublisher(
  pbus: ScopedEventBus,
): DeadLetterChangedPublisher {
  return (payload) => pbus.emit("workflow.dead-letter.changed", payload);
}

export function moduleDeadLetterChangedPublisher(
  scopeRoot: string,
  events: ModuleEventProxy,
): DeadLetterChangedPublisher {
  const scopeId = deriveDirectoryScopeId(scopeRoot);
  return (payload) => events.emit("workflow.dead-letter.changed", {
    scopeId,
    ...payload,
  });
}

export class EventedDeadLetterQueueStore extends DeadLetterQueueStore {
  constructor(
    dir: string,
    now: () => Date = () => new Date(),
    private readonly publishChanged: DeadLetterChangedPublisher,
  ) {
    super(dir, now);
  }

  override record(input: DeadLetterQueueRecordInput): DeadLetterItem {
    return this.emitChanged(super.record(input));
  }

  override dismiss(id: string, reason: string): DeadLetterItem | null {
    const item = super.dismiss(id, reason);
    return item === null ? null : this.emitChanged(item);
  }

  override recordRedriveAttempt(
    id: string,
    attempt: Omit<DeadLetterRedriveAttempt, "attemptedAt">,
  ): DeadLetterItem | null {
    const item = super.recordRedriveAttempt(id, attempt);
    return item === null ? null : this.emitChanged(item);
  }

  private emitChanged(item: DeadLetterItem): DeadLetterItem {
    this.publishChanged(deadLetterChangedEventPayload(item));
    return item;
  }
}
