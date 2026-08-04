import type { KotaConfig } from "#core/config/config.js";
import { getPreset, SHIPPED_DEFAULT_PRESET_ID } from "#core/model/preset.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowAgentBackoffSignal, WorkflowAgentBackoffState } from "./trigger-types.js";

const MAX_AGENT_BACKOFF_MS = 6 * 60 * 60 * 1000;
const AGENT_BACKOFF_FACTORS: Record<
  WorkflowAgentBackoffState["kind"],
  { initialDelayMs: number; backoffFactor: number }
> = {
  rate_limit: { initialDelayMs: 30 * 60 * 1000, backoffFactor: 2 },
  auth: { initialDelayMs: 30 * 60 * 1000, backoffFactor: 2 },
  provider: { initialDelayMs: 5 * 60 * 1000, backoffFactor: 2 },
  runtime: { initialDelayMs: 30 * 60 * 1000, backoffFactor: 2 },
};

export class AgentBackoffManager {
  constructor(
    private readonly store: WorkflowRunStore,
    private readonly log: (msg: string) => void,
    private readonly runtimeId: string,
  ) {}

  private getStored(): WorkflowAgentBackoffState | null {
    return this.store.readState().agentBackoff ?? null;
  }

  getActive(): WorkflowAgentBackoffState | null {
    const backoff = this.getStored();
    if (!backoff) return null;

    if (backoff.runtimeId !== this.runtimeId) {
      this.store.setAgentBackoff(null);
      this.log(
        `Cleared agent dispatch backoff from runtime ${backoff.runtimeId}; active runtime is ${this.runtimeId}`,
      );
      return null;
    }

    const untilMs = new Date(backoff.until).getTime();
    if (untilMs > Date.now()) return backoff;

    return null;
  }

  apply(signal: WorkflowAgentBackoffSignal): void {
    const current = this.getStored();
    const policy = AGENT_BACKOFF_FACTORS[signal.kind];
    const nextFailureCount =
      current && current.kind === signal.kind ? current.failureCount + 1 : 1;
    const delayMs = Math.min(
      MAX_AGENT_BACKOFF_MS,
      Math.round(policy.initialDelayMs * policy.backoffFactor ** (nextFailureCount - 1)),
    );
    const policyUntilMs = Date.now() + delayMs;
    const retryAtMs = signal.retryAt === undefined
      ? Number.NaN
      : new Date(signal.retryAt).getTime();
    const untilMs = Number.isFinite(retryAtMs)
      ? Math.max(policyUntilMs, retryAtMs)
      : policyUntilMs;
    const backoff: WorkflowAgentBackoffState = {
      runtimeId: this.runtimeId,
      kind: signal.kind,
      failureCount: nextFailureCount,
      until: new Date(untilMs).toISOString(),
      updatedAt: new Date().toISOString(),
      reason: signal.reason,
    };
    this.store.setAgentBackoff(backoff);
    this.log(
      `Agent dispatch backed off until ${new Date(backoff.until).toLocaleString()} (${backoff.kind}, attempt ${backoff.failureCount})`,
    );
  }

  clear(): void {
    const backoff = this.getStored();
    if (!backoff) return;
    this.store.setAgentBackoff(null);
    this.log(
      `Cleared agent dispatch backoff after successful agent run (${backoff.kind})`,
    );
  }
}

export function workflowAgentRuntimeId(config: KotaConfig | undefined): string {
  const preset = getPreset(config?.defaultPreset ?? SHIPPED_DEFAULT_PRESET_ID);
  return `${preset.id}:${config?.defaultAgentHarness ?? preset.harness}`;
}
