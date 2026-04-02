import { validatePayloadSchema } from "./payload-validator.js";
import { getEligibleAtMs } from "./run-executor-utils.js";
import type { WorkflowRunStore } from "./run-store.js";
import { formatRunId } from "./run-store-helpers.js";
import type { WorkflowQueuedRun } from "./run-types.js";
import type {
  WorkflowAgentBackoffState,
  WorkflowDefinition,
  WorkflowRunTrigger,
} from "./types.js";

export type WorkflowQueueManagerConfig = {
  store: WorkflowRunStore;
  getActiveBackoff: () => WorkflowAgentBackoffState | null;
  getWorkflowBudgetPauseUntil: (workflowName: string) => string | null;
  shouldSuppressBackoff: (
    definition: WorkflowDefinition,
  ) => WorkflowAgentBackoffState | null;
  workflowUsesAgent: (definition: WorkflowDefinition) => boolean;
  isActiveRun: (workflowName: string) => boolean;
  getDefinitions: () => WorkflowDefinition[];
  log: (message: string) => void;
};

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
    const activeAgentBackoff = this.config.getActiveBackoff();
    const validNames = new Set(
      this.config
        .getDefinitions()
        .filter((definition) => definition.enabled)
        .map((definition) => definition.name),
    );
    this.queue = state.pendingRuns.filter((item) => {
      if (!validNames.has(item.workflowName)) return false;
      const definition = this.config
        .getDefinitions()
        .find((candidate) => candidate.name === item.workflowName);
      if (definition?.dailyBudgetUsd != null && this.config.getWorkflowBudgetPauseUntil(item.workflowName)) {
        return false;
      }
      if (!activeAgentBackoff) return true;
      return !definition || !this.config.workflowUsesAgent(definition);
    });
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
    const budgetPauseUntil =
      definition.dailyBudgetUsd != null
        ? this.config.getWorkflowBudgetPauseUntil(definition.name)
        : null;
    if (budgetPauseUntil) {
      if (trigger.event !== "runtime.idle") {
        this.config.log(
          `Skipped workflow "${definition.name}" from event "${trigger.event}" during budget pause until ${new Date(budgetPauseUntil).toLocaleTimeString()}`,
        );
      }
      return;
    }

    const activeAgentBackoff = this.config.shouldSuppressBackoff(definition);
    if (activeAgentBackoff) {
      if (trigger.event !== "runtime.idle") {
        this.config.log(
          `Skipped workflow "${definition.name}" from event "${trigger.event}" during agent backoff (${activeAgentBackoff.kind} until ${new Date(activeAgentBackoff.until).toLocaleTimeString()})`,
        );
      }
      return;
    }

    if (definition.inputSchema) {
      const schemaError = validatePayloadSchema(definition.inputSchema, trigger.payload);
      if (schemaError) {
        this.config.log(
          `Rejected trigger for workflow "${definition.name}": payload validation failed — ${schemaError}`,
        );
        return;
      }
    }

    const existingIndex = this.queue.findIndex(
      (queued) => queued.workflowName === definition.name,
    );
    const state = this.config.store.readState();
    const existing = existingIndex >= 0 ? this.queue[existingIndex] : undefined;
    const queuedRun: WorkflowQueuedRun = {
      runId: existing?.runId ?? formatRunId(definition.name),
      workflowName: definition.name,
      trigger,
      enqueuedAtMs: existing ? existing.enqueuedAtMs : Date.now(),
      notBeforeMs: getEligibleAtMs(
        definition.name,
        triggerConfig.cooldownMs,
        state,
      ),
    };

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
    const eligible = this.queue
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const definition = this.config
          .getDefinitions()
          .find((candidate) => candidate.name === item.workflowName);
        const budgetPaused =
          definition?.dailyBudgetUsd != null &&
          Boolean(this.config.getWorkflowBudgetPauseUntil(item.workflowName));
        if (
          item.notBeforeMs > now ||
          this.config.isActiveRun(item.workflowName) ||
          budgetPaused
        ) {
          return false;
        }
        if (activeAgentBackoff && definition && this.config.workflowUsesAgent(definition)) {
          return false;
        }
        if (canDispatch && definition && !canDispatch(definition)) return false;
        return true;
      })
      .sort((a, b) => a.item.enqueuedAtMs - b.item.enqueuedAtMs);

    if (eligible.length === 0) return null;
    const picked = eligible[0];
    this.queue.splice(picked.index, 1);
    this.persist();
    return picked.item;
  }
}
