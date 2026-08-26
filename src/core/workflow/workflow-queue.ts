import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { RunCoordinator } from "./run-coordinator.js";
import { getEligibleAtMs, matchesFilter } from "./run-executor-utils.js";
import { formatRunId, workflowRunIdFromPayload } from "./run-io.js";
import {
  AdmissionKeyConflictError,
  type RunAdmissionDisposition,
  type RunStateDatabase,
  type StoredRun,
} from "./run-state-database.js";
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
import { rejectInvalidTriggerPayload } from "./workflow-queue-validation.js";
import { rejectUnadmittedWorkflowTrigger } from "./workflow-trigger-admission.js";

export type WorkflowQueueManagerConfig = {
  store: WorkflowRunStore;
  runState: RunStateDatabase;
  coordinator: RunCoordinator;
  projectId: string;
  projectDir: string;
  deadLetterQueue?: DeadLetterQueueStore;
  getScopeId: () => string;
  getActiveBackoff: () => WorkflowAgentBackoffState | null;
  workflowUsesAgent: (definition: WorkflowDefinition) => boolean;
  getDefinitions: () => WorkflowDefinition[];
  log: (message: string) => void;
};

function asQueued(run: StoredRun): WorkflowQueuedRun {
  return {
    runId: run.id,
    workflowName: run.workflow,
    trigger: run.trigger,
    enqueuedAtMs: Date.parse(run.admittedAt),
    notBeforeMs: run.notBeforeAt ? Date.parse(run.notBeforeAt) : Date.parse(run.admittedAt),
  };
}

function sameResources(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

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

/** Trigger admission adapter. RunStateDatabase is the only durable queue. */
export class WorkflowQueueManager {
  constructor(private readonly config: WorkflowQueueManagerConfig) {}

  get length(): number {
    return this.getRuns().length;
  }

  getRuns(): WorkflowQueuedRun[] {
    return this.config.runState
      .listRuns(this.config.projectId, ["queued"])
      .map(asQueued);
  }

  /** Revalidate durable queued work after definitions are loaded. */
  restorePending(): void {
    const definitions = new Map(
      this.config
        .getDefinitions()
        .filter((definition) => definition.enabled)
        .map((definition) => [definition.name, definition]),
    );
    const pending = this.config.runState.listRuns(this.config.projectId, [
      "queued",
    ]);
    let restored = 0;
    for (const run of pending) {
      const definition = definitions.get(run.workflow);
      if (!definition) {
        this.cancelRestoredRun(run, "workflow is unavailable or disabled");
        continue;
      }
      const resolution = resolveRestoredTrigger(definition, run.trigger);
      if (resolution === null) {
        this.cancelRestoredRun(
          run,
          `event "${run.trigger.event}" is not accepted by the current definition`,
        );
        continue;
      }
      if (
        resolution.kind === "declared" &&
        rejectInvalidTriggerPayload({
          definition,
          trigger: run.trigger,
          deadLetterQueue: this.config.deadLetterQueue,
          scopeId: this.config.getScopeId(),
          log: this.config.log,
        })
      ) {
        this.cancelRestoredRun(run, "payload validation failed");
        continue;
      }
      if (
        rejectUnadmittedWorkflowTrigger({
          definition,
          projectDir: this.config.projectDir,
          stateDir: this.config.store.rootDir,
          projectId: this.config.projectId,
          runState: this.config.runState,
          trigger: run.trigger,
          log: this.config.log,
        })
      ) {
        this.cancelRestoredRun(run, "definition admission rejected the trigger");
        continue;
      }
      const resources = definition.resources?.({
        projectDir: this.config.projectDir,
        stateDir: this.config.store.rootDir,
        workflowName: definition.name,
        trigger: run.trigger,
      }) ?? [];
      if (
        run.repository !== definition.repository ||
        !sameResources(run.resources, resources)
      ) {
        this.cancelRestoredRun(
          run,
          "definition repository or resource ownership changed",
        );
        continue;
      }
      restored += 1;
    }
    if (restored > 0) {
      this.config.log(`Recovered ${restored} durable queued workflow run(s)`);
    }
    this.config.coordinator.refill();
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
      }) ||
      rejectUnadmittedWorkflowTrigger({
        definition,
        projectDir: this.config.projectDir,
        stateDir: this.config.store.rootDir,
        projectId: this.config.projectId,
        runState: this.config.runState,
        trigger,
        log: this.config.log,
      })
    ) return;

    const now = Date.now();
    const backoff = this.config.workflowUsesAgent(definition)
      ? this.config.getActiveBackoff()
      : null;
    const eligibleAt = Math.max(
      getEligibleAtMs(
        definition.name,
        triggerConfig.cooldownMs,
        this.config.store.readState(),
      ),
      backoff ? Date.parse(backoff.until) : now,
    );
    const providedRunId = workflowRunIdFromPayload(
      typeof trigger.payload._runId === "string" ? trigger.payload._runId : undefined,
      `Workflow "${definition.name}" trigger`,
    );
    const resources = definition.resources?.({
      projectDir: this.config.projectDir,
      stateDir: this.config.store.rootDir,
      workflowName: definition.name,
      trigger,
    }) ?? [];
    const distinct =
      trigger.event === WORKFLOW_BATCH_FLUSH_EVENT ||
      triggerConfig.queueMode === "all" ||
      (hasExplicitWorkflowDispatchKey(trigger) && triggerConfig.queueMode !== "latest");
    const existing = distinct
      ? null
      : this.config.runState.findQueuedRun({
          projectId: this.config.projectId,
          workflow: definition.name,
          triggerEvent: trigger.event,
        });

    const runId = existing && sameResources(existing.resources, resources)
      ? existing.id
      : providedRunId ?? formatRunId(definition.name);
    const admission = workflowDispatchIdempotency(
      this.config.getScopeId(),
      definition.name,
      trigger,
    ) ?? undefined;

    if (existing?.id === runId) {
      try {
        const disposition = this.config.runState.updateQueuedRun({
          runId,
          trigger,
          admission,
          admittedAt: new Date(now).toISOString(),
          notBeforeAt: new Date(
            Math.max(existing.notBeforeAt ? Date.parse(existing.notBeforeAt) : 0, eligibleAt),
          ).toISOString(),
        });
        this.config.log(
          `${disposition.status === "duplicate" ? "Retained" : "Updated"} queued workflow "${definition.name}" from event "${trigger.event}"`,
        );
      } catch (error) {
        if (!(error instanceof AdmissionKeyConflictError)) throw error;
        this.config.log(
          `Rejected workflow "${definition.name}" from event "${trigger.event}": ${error.message}`,
        );
        return;
      }
    } else {
      this.admit(definition, trigger, runId, now, eligibleAt, resources, admission);
    }
    this.config.coordinator.refill();
  }

  appendRun(queued: WorkflowQueuedRun): RunAdmissionDisposition | null {
    const definition = this.definition(queued.workflowName);
    if (!definition?.enabled) return null;
    if (
      rejectInvalidTriggerPayload({
        definition,
        trigger: queued.trigger,
        deadLetterQueue: this.config.deadLetterQueue,
        scopeId: this.config.getScopeId(),
        log: this.config.log,
      }) ||
      rejectUnadmittedWorkflowTrigger({
        definition,
        projectDir: this.config.projectDir,
        stateDir: this.config.store.rootDir,
        projectId: this.config.projectId,
        runState: this.config.runState,
        trigger: queued.trigger,
        log: this.config.log,
      })
    ) {
      return null;
    }
    const disposition = this.admit(
      definition,
      queued.trigger,
      queued.runId ?? formatRunId(queued.workflowName),
      queued.enqueuedAtMs,
      queued.notBeforeMs,
    );
    this.config.coordinator.refill();
    return disposition;
  }

  appendResumeRun(queued: WorkflowQueuedRun): void {
    const runId = queued.runId ?? formatRunId(queued.workflowName);
    const current = this.config.runState.getRun(runId);
    if (current?.state === "waiting" || current?.state === "needs_attention") {
      this.config.runState.resumeRun(runId, new Date(queued.notBeforeMs).toISOString());
      this.config.coordinator.refill();
      return;
    }
    this.appendRun(queued);
  }

  cancel(runId: string): { cancelled: boolean } {
    return { cancelled: this.config.coordinator.cancel(runId) };
  }

  cancelByWorkflow(workflowName: string): number {
    let cancelled = 0;
    for (const run of this.config.runState.listRuns(this.config.projectId)) {
      if (run.workflow !== workflowName) continue;
      if (this.config.coordinator.cancel(run.id)) cancelled += 1;
    }
    return cancelled;
  }

  private definition(name: string): WorkflowDefinition | undefined {
    return this.config.getDefinitions().find((candidate) => candidate.name === name);
  }

  private cancelRestoredRun(run: StoredRun, reason: string): void {
    this.config.runState.cancelQueuedRun(run.id, new Date().toISOString());
    this.config.log(
      `Cancelled durable queued workflow "${run.workflow}" (${run.id}): ${reason}`,
    );
  }

  private admit(
    definition: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
    runId: string,
    enqueuedAtMs: number,
    notBeforeMs: number,
    resolvedResources?: readonly string[],
    resolvedAdmission?: ReturnType<typeof workflowDispatchIdempotency> | undefined,
  ): RunAdmissionDisposition | null {
    const resources = resolvedResources ?? definition.resources?.({
      projectDir: this.config.projectDir,
      stateDir: this.config.store.rootDir,
      workflowName: definition.name,
      trigger,
    }) ?? [];
    const admission = resolvedAdmission ?? workflowDispatchIdempotency(
      this.config.getScopeId(),
      definition.name,
      trigger,
    ) ?? undefined;
    try {
      const disposition = this.config.runState.admitRun({
        id: runId,
        projectId: this.config.projectId,
        workflow: definition.name,
        trigger,
        repository: definition.repository,
        resources,
        admission,
        admittedAt: new Date(enqueuedAtMs).toISOString(),
        ...(notBeforeMs > enqueuedAtMs
          ? { notBeforeAt: new Date(notBeforeMs).toISOString() }
          : {}),
      });
      this.config.log(
        `${disposition.status === "duplicate" ? "Retained" : "Admitted"} workflow "${definition.name}" from event "${trigger.event}"`,
      );
      return disposition;
    } catch (error) {
      if (error instanceof AdmissionKeyConflictError) {
        this.config.log(
          `Rejected workflow "${definition.name}" from event "${trigger.event}": ${error.message}`,
        );
        return null;
      }
      throw error;
    }
  }
}
