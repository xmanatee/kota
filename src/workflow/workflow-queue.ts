import { getEligibleAtMs } from "./run-executor-utils.js";
import type { WorkflowRunStore } from "./run-store.js";
import type {
  WorkflowAgentBackoffState,
  WorkflowDefinition,
  WorkflowQueuedRun,
  WorkflowRunTrigger,
} from "./types.js";

export type WorkflowQueueManagerConfig = {
  store: WorkflowRunStore;
  getActiveBackoff: () => WorkflowAgentBackoffState | null;
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
      if (!activeAgentBackoff) return true;
      const definition = this.config
        .getDefinitions()
        .find((candidate) => candidate.name === item.workflowName);
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
    const activeAgentBackoff = this.config.shouldSuppressBackoff(definition);
    if (activeAgentBackoff) {
      if (trigger.event !== "runtime.idle") {
        this.config.log(
          `Skipped workflow "${definition.name}" from event "${trigger.event}" during agent backoff (${activeAgentBackoff.kind} until ${new Date(activeAgentBackoff.until).toLocaleTimeString()})`,
        );
      }
      return;
    }

    const existingIndex = this.queue.findIndex(
      (queued) => queued.workflowName === definition.name,
    );
    const state = this.config.store.readState();
    const queuedRun: WorkflowQueuedRun = {
      workflowName: definition.name,
      trigger,
      enqueuedAtMs:
        existingIndex >= 0
          ? this.queue[existingIndex].enqueuedAtMs
          : Date.now(),
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
          this.queue[existingIndex].notBeforeMs,
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

  pick(): WorkflowQueuedRun | null {
    const now = Date.now();
    const activeAgentBackoff = this.config.getActiveBackoff();
    const eligible = this.queue
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (
          item.notBeforeMs > now ||
          this.config.isActiveRun(item.workflowName)
        ) {
          return false;
        }
        if (!activeAgentBackoff) return true;
        const definition = this.config
          .getDefinitions()
          .find((candidate) => candidate.name === item.workflowName);
        return !definition || !this.config.workflowUsesAgent(definition);
      })
      .sort((a, b) => a.item.enqueuedAtMs - b.item.enqueuedAtMs);

    if (eligible.length === 0) return null;
    const picked = eligible[0];
    this.queue.splice(picked.index, 1);
    this.persist();
    return picked.item;
  }
}
