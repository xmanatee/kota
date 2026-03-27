import type { WorkflowRunStore } from "./run-store.js";
import type {
  WorkflowAgentBackoffSignal,
  WorkflowAgentBackoffState,
  WorkflowDefinition,
  WorkflowQueuedRun,
} from "./types.js";

const MAX_AGENT_BACKOFF_MS = 6 * 60 * 60 * 1000;
const AGENT_BACKOFF_FACTORS: Record<
  WorkflowAgentBackoffState["kind"],
  { initialDelayMs: number; backoffFactor: number }
> = {
  rate_limit: { initialDelayMs: 30 * 60 * 1000, backoffFactor: 2 },
  auth: { initialDelayMs: 30 * 60 * 1000, backoffFactor: 2 },
  provider: { initialDelayMs: 5 * 60 * 1000, backoffFactor: 2 },
};

export class AgentBackoffManager {
  constructor(
    private readonly store: WorkflowRunStore,
    private readonly getQueue: () => WorkflowQueuedRun[],
    private readonly setQueue: (queue: WorkflowQueuedRun[]) => void,
    private readonly persistQueue: () => void,
    private readonly getDefinitions: () => WorkflowDefinition[],
    private readonly workflowUsesAgent: (def: WorkflowDefinition) => boolean,
    private readonly log: (msg: string) => void,
  ) {}

  getActive(): WorkflowAgentBackoffState | null {
    const state = this.store.readState();
    const backoff = state.agentBackoff;
    if (!backoff) return null;

    const untilMs = new Date(backoff.until).getTime();
    if (untilMs > Date.now()) return backoff;

    this.store.setAgentBackoff(null);
    this.log(`Agent dispatch backoff expired (${backoff.kind})`);
    return null;
  }

  dropQueuedAgentWorkflows(): number {
    const queue = this.getQueue();
    const nextQueue = queue.filter((item) => {
      const definition = this.getDefinitions().find(
        (candidate) => candidate.name === item.workflowName,
      );
      return !definition || !this.workflowUsesAgent(definition);
    });
    const removed = queue.length - nextQueue.length;
    if (removed > 0) {
      this.setQueue(nextQueue);
      this.persistQueue();
    }
    return removed;
  }

  apply(signal: WorkflowAgentBackoffSignal): void {
    const current = this.getActive();
    const policy = AGENT_BACKOFF_FACTORS[signal.kind];
    const nextFailureCount =
      current && current.kind === signal.kind ? current.failureCount + 1 : 1;
    const delayMs = Math.min(
      MAX_AGENT_BACKOFF_MS,
      Math.round(policy.initialDelayMs * policy.backoffFactor ** (nextFailureCount - 1)),
    );
    const backoff: WorkflowAgentBackoffState = {
      kind: signal.kind,
      failureCount: nextFailureCount,
      until: new Date(Date.now() + delayMs).toISOString(),
      updatedAt: new Date().toISOString(),
      reason: signal.reason,
    };
    this.store.setAgentBackoff(backoff);
    const dropped = this.dropQueuedAgentWorkflows();
    this.log(
      `Agent dispatch backed off until ${new Date(backoff.until).toLocaleString()} (${backoff.kind}, attempt ${backoff.failureCount})`,
    );
    if (dropped > 0) {
      this.log(`Dropped ${dropped} queued agent workflow run(s) during backoff`);
    }
  }

  clear(): void {
    const backoff = this.getActive();
    if (!backoff) return;
    this.store.setAgentBackoff(null);
    this.log(
      `Cleared agent dispatch backoff after successful agent run (${backoff.kind})`,
    );
  }

  shouldSuppress(definition: WorkflowDefinition): WorkflowAgentBackoffState | null {
    if (!this.workflowUsesAgent(definition)) return null;
    return this.getActive();
  }
}
