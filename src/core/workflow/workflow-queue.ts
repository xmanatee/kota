import type { KotaConfig } from "#core/config/config.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { getEligibleAtMs, matchesFilter } from "./run-executor-utils.js";
import { formatRunId, workflowRunIdFromPayload } from "./run-io.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowQueuedRun } from "./run-types.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowAgentBackoffState,
  type WorkflowBatchFlushPayload,
  type WorkflowRunTrigger,
  type WorkflowTrigger,
} from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";
import {
  hasExplicitWorkflowDispatchKey,
  workflowDispatchIdempotency,
} from "./workflow-idempotency.js";
import {
  buildBurstQueuedRuns,
  burstDispatchSlots,
  resolveWorkflowDispatchBurst,
} from "./workflow-queue-burst.js";
import { rejectInvalidTriggerPayload } from "./workflow-queue-validation.js";
import { rejectUnadmittedWorkflowTrigger } from "./workflow-trigger-admission.js";

export type WorkflowQueueManagerConfig = {
  store: WorkflowRunStore;
  projectDir?: string;
  getConfig?: () => KotaConfig | undefined;
  idempotencyStore: IdempotencyStore;
  deadLetterQueue?: DeadLetterQueueStore;
  getScopeId: () => string;
  getActiveBackoff: () => WorkflowAgentBackoffState | null;
  workflowUsesAgent: (definition: WorkflowDefinition) => boolean;
  concurrencyLimit: (definition: WorkflowDefinition) => number;
  isActiveRun: (workflowName: string) => boolean;
  activeRunCount?: (workflowName: string) => number;
  getDefinitions: () => WorkflowDefinition[];
  log: (message: string) => void;
};

const RESTORABLE_CONTROL_TRIGGER_EVENTS = new Set([
  "manual",
  "resume",
  "workflow.triggered",
]);

type RestoredTriggerResolution =
  | { kind: "control" }
  | { kind: "declared"; triggerConfig: WorkflowTrigger };

function resolveRestoredTrigger(
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
): RestoredTriggerResolution | null {
  if (RESTORABLE_CONTROL_TRIGGER_EVENTS.has(trigger.event)) {
    return { kind: "control" };
  }
  if (trigger.event === WORKFLOW_BATCH_FLUSH_EVENT) {
    const payload = trigger.payload as Partial<WorkflowBatchFlushPayload>;
    const triggerIndex = payload.batch?.triggerIndex;
    if (
      payload.batch?.workflow !== definition.name ||
      typeof payload.sourceEventName !== "string" ||
      typeof triggerIndex !== "number" ||
      !Number.isInteger(triggerIndex) ||
      triggerIndex < 0
    ) {
      return null;
    }
    const triggerConfig = definition.triggers[triggerIndex];
    if (
      !triggerConfig?.batch ||
      triggerConfig.event !== payload.sourceEventName
    ) {
      return null;
    }
    return { kind: "declared", triggerConfig };
  }
  const triggerConfig = definition.triggers.find(
    (candidate) =>
      !candidate.batch &&
      candidate.event === trigger.event &&
      matchesFilter(candidate.filter, trigger.payload),
  );
  return triggerConfig ? { kind: "declared", triggerConfig } : null;
}

function restoredRunIsDistinct(
  triggerConfig: WorkflowTrigger,
  trigger: WorkflowRunTrigger,
  dispatchBurst: number,
): boolean {
  return trigger.event === WORKFLOW_BATCH_FLUSH_EVENT ||
    dispatchBurst > 1 ||
    triggerConfig.queueMode === "all" ||
    (hasExplicitWorkflowDispatchKey(trigger) &&
      triggerConfig.queueMode !== "latest");
}

export class WorkflowQueueManager {
  private queue: WorkflowQueuedRun[] = [];

  constructor(private readonly config: WorkflowQueueManagerConfig) {}

  get length(): number {
    return this.queue.length;
  }

  getRuns(): WorkflowQueuedRun[] {
    return this.queue;
  }

  setRuns(runs: WorkflowQueuedRun[]): void {
    this.queue = runs;
  }

  persist(): void {
    this.config.store.setPendingRuns(this.queue);
  }

  restorePending(): void {
    const state = this.config.store.readState();
    const definitions = new Map(
      this.config
        .getDefinitions()
        .filter((definition) => definition.enabled)
        .map((definition) => [definition.name, definition]),
    );
    const restored: WorkflowQueuedRun[] = [];
    for (const item of state.pendingRuns) {
      const definition = definitions.get(item.workflowName);
      if (!definition) continue;
      const resolution = resolveRestoredTrigger(definition, item.trigger);
      if (!resolution) {
        this.config.log(
          `Skipped restored workflow "${definition.name}" from event "${item.trigger.event}": event is not accepted by the current definition`,
        );
        continue;
      }
      if (
        resolution.kind === "declared" &&
        rejectInvalidTriggerPayload({
          definition,
          trigger: item.trigger,
          deadLetterQueue: this.config.deadLetterQueue,
          scopeId: this.config.getScopeId(),
          log: this.config.log,
        })
      ) {
        continue;
      }
      if (
        rejectUnadmittedWorkflowTrigger({
          definition,
          projectDir: this.config.projectDir ?? process.cwd(),
          trigger: item.trigger,
          log: this.config.log,
        })
      ) {
        continue;
      }
      if (
        resolution.kind === "declared" &&
        !restoredRunIsDistinct(
          resolution.triggerConfig,
          item.trigger,
          resolveWorkflowDispatchBurst({
            definition,
            trigger: item.trigger,
            projectDir: this.config.projectDir ?? process.cwd(),
            config: this.config.getConfig?.(),
            concurrencyLimit: this.config.concurrencyLimit(definition),
          }),
        )
      ) {
        const existingIndex = restored.findIndex(
          (queued) =>
            queued.workflowName === item.workflowName &&
            queued.trigger.event === item.trigger.event,
        );
        if (existingIndex >= 0) {
          const existing = restored[existingIndex]!;
          restored[existingIndex] = {
            ...item,
            runId: existing.runId,
            enqueuedAtMs: existing.enqueuedAtMs,
            notBeforeMs: Math.max(existing.notBeforeMs, item.notBeforeMs),
          };
          this.config.log(
            `Coalesced restored workflow "${definition.name}" with event "${item.trigger.event}" against the current definition`,
          );
          continue;
        }
      }
      restored.push(item);
    }
    this.queue = restored;
    this.persist();
    if (this.queue.length > 0) {
      this.config.log(`Recovered ${this.queue.length} queued workflow run(s)`);
    }
  }

  enqueue(
    definition: WorkflowDefinition,
    triggerConfig: WorkflowDefinition["triggers"][number],
    trigger: WorkflowRunTrigger,
  ): void {
    if (
      rejectInvalidTriggerPayload({
        definition,
        trigger,
        deadLetterQueue: this.config.deadLetterQueue,
        scopeId: this.config.getScopeId(),
        log: this.config.log,
      })
    ) return;

    if (rejectUnadmittedWorkflowTrigger({
      definition,
      projectDir: this.config.projectDir ?? process.cwd(),
      trigger,
      log: this.config.log,
    })) return;

    const dispatchBurst = resolveWorkflowDispatchBurst({
      definition,
      trigger,
      projectDir: this.config.projectDir ?? process.cwd(),
      config: this.config.getConfig?.(),
      concurrencyLimit: this.config.concurrencyLimit(definition),
    });
    const queueEveryDelivery = triggerConfig.queueMode === "all";
    const explicitlyKeyed = hasExplicitWorkflowDispatchKey(trigger);
    const idempotency = workflowDispatchIdempotency(
      this.config.idempotencyStore,
      definition.name,
      trigger,
    );
    const distinctQueuedRun =
      trigger.event === WORKFLOW_BATCH_FLUSH_EVENT ||
      dispatchBurst > 1 ||
      queueEveryDelivery ||
      (explicitlyKeyed && triggerConfig.queueMode !== "latest");
    const existingIndex = distinctQueuedRun
      ? -1
      : this.queue.findIndex(
          (queued) =>
            queued.workflowName === definition.name &&
            queued.trigger.event === trigger.event,
        );
    const state = this.config.store.readState();
    const existing = existingIndex >= 0 ? this.queue[existingIndex] : undefined;
    const providedRunId =
      workflowRunIdFromPayload(
        typeof trigger.payload._runId === "string" ? trigger.payload._runId : undefined,
        `Workflow "${definition.name}" trigger`,
      );
    const queuedRun: WorkflowQueuedRun = {
      runId: existing?.runId ?? providedRunId ?? formatRunId(definition.name),
      workflowName: definition.name,
      trigger,
      enqueuedAtMs: existing ? existing.enqueuedAtMs : Date.now(),
      notBeforeMs: getEligibleAtMs(
        definition.name,
        triggerConfig.cooldownMs,
        state,
      ),
    };

    if (idempotency) {
      const idempotencyResult = this.config.idempotencyStore.record({
        scopeId: idempotency.scopeId,
        operation: "workflow-dispatch",
        key: idempotency.key,
        parameterFingerprint: idempotency.parameterFingerprint,
        result: {
          workflowName: definition.name,
          runId: queuedRun.runId ?? "",
          triggerEvent: trigger.event,
          queuedAt: new Date(queuedRun.enqueuedAtMs).toISOString(),
        },
      });
      if (idempotencyResult.status !== "accepted") {
        this.config.log(
          `Skipped workflow "${definition.name}" from event "${trigger.event}" due to idempotency status "${idempotencyResult.status}"`,
        );
        return;
      }
    }

    if (dispatchBurst > 1) {
      const queuedSameWorkflow = this.queue.filter(
        (item) => item.workflowName === definition.name,
      ).length;
      const activeSameWorkflow = this.config.activeRunCount?.(definition.name) ?? 0;
      const slots = burstDispatchSlots({
        dispatchBurst,
        queuedSameWorkflow,
        activeSameWorkflow,
      });
      if (slots === 0) {
        this.config.log(
          `Skipped workflow "${definition.name}" from event "${trigger.event}" because burst dispatch is already full`,
        );
        return;
      }
      const runs = buildBurstQueuedRuns({ queuedRun, slots });
      this.queue.push(...runs);
      this.persist();
      this.config.log(
        `${this.config.isActiveRun(definition.name) ? "Queued reruns for" : "Queued"} workflow "${definition.name}" from event "${trigger.event}" (${runs.length} run(s))`,
      );
      return;
    }

    if (existingIndex >= 0) {
      this.queue[existingIndex] = {
        ...queuedRun,
        notBeforeMs: Math.max(
          existing!.notBeforeMs,
          queuedRun.notBeforeMs,
        ),
      };
      this.config.log(
        `Updated queued workflow "${definition.name}" with event "${trigger.event}"`,
      );
      this.persist();
      return;
    }

    this.queue.push(queuedRun);
    this.persist();
    this.config.log(
      `${this.config.isActiveRun(definition.name) ? "Queued rerun for" : "Queued"} workflow "${definition.name}" from event "${trigger.event}"`,
    );
  }

  appendRun(queued: WorkflowQueuedRun): void {
    if (this.queue.some((item) => item.runId === queued.runId)) return;
    this.queue.push(queued);
    this.persist();
  }

  appendResumeRun(queued: WorkflowQueuedRun): void {
    this.appendRun(queued);
  }

  cancel(runId: string): { cancelled: boolean } {
    const index = this.queue.findIndex((item) => item.runId === runId);
    if (index === -1) return { cancelled: false };
    this.queue.splice(index, 1);
    this.persist();
    return { cancelled: true };
  }

  cancelByWorkflow(workflowName: string): number {
    const before = this.queue.length;
    this.queue = this.queue.filter((item) => item.workflowName !== workflowName);
    const removed = before - this.queue.length;
    if (removed > 0) this.persist();
    return removed;
  }

  pick(canDispatch?: (def: WorkflowDefinition) => boolean): WorkflowQueuedRun | null {
    const now = Date.now();
    const activeAgentBackoff = this.config.getActiveBackoff();
    const freshState = this.config.store.readState();
    let timingChanged = false;
    const eligible = this.queue
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const definition = this.config
          .getDefinitions()
          .find((candidate) => candidate.name === item.workflowName);

        // Avoid enqueue-time cooldown drift after concurrent finish() writes.
        let effectiveNotBefore = item.notBeforeMs;
        if (definition) {
          const trigger = definition.triggers.find(
            (t) => t.event === item.trigger.event,
          );
          if (trigger) {
            if (trigger.cooldownMs > 0) {
              const lastCompletedAt =
                freshState.workflows[item.workflowName]?.lastCompletion?.completedAt;
              if (lastCompletedAt) {
                const freshEligibleAtMs =
                  new Date(lastCompletedAt).getTime() + trigger.cooldownMs;
                effectiveNotBefore = Math.max(effectiveNotBefore, freshEligibleAtMs);
              }
            } else {
              effectiveNotBefore = Math.min(effectiveNotBefore, now);
            }
          }
        }

        if (effectiveNotBefore !== item.notBeforeMs) {
          item.notBeforeMs = effectiveNotBefore;
          timingChanged = true;
        }
        if (effectiveNotBefore > now) {
          return false;
        }
        if (!canDispatch && this.config.isActiveRun(item.workflowName)) return false;
        if (activeAgentBackoff && definition && this.config.workflowUsesAgent(definition)) {
          return false;
        }
        if (canDispatch && definition && !canDispatch(definition)) return false;
        return true;
      })
      .sort((a, b) => a.item.enqueuedAtMs - b.item.enqueuedAtMs);

    if (eligible.length === 0) {
      if (timingChanged) this.persist();
      return null;
    }
    const picked = eligible[0];
    this.queue.splice(picked.index, 1);
    this.persist();
    return picked.item;
  }
}
