import type { KotaConfig } from "#core/config/config.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import type { ScopeRuntimeStateStore } from "./scope-runtime-state.js";
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
    private readonly store: ScopeRuntimeStateStore,
    private readonly log: (msg: string) => void,
    private readonly runtimeId: string,
  ) {}

  private getStored(): WorkflowAgentBackoffState | null {
    return this.store.getAgentBackoff();
  }

  getActive(): WorkflowAgentBackoffState | null {
    const backoff = this.getStored();
    if (!backoff) return null;
    if (backoff.runtimeId !== this.runtimeId) return null;

    const untilMs = new Date(backoff.until).getTime();
    if (untilMs > Date.now()) return backoff;

    return null;
  }

  getSupersededRuntime(): WorkflowAgentBackoffState | null {
    const backoff = this.getStored();
    if (!backoff || backoff.runtimeId === this.runtimeId) return null;
    return backoff;
  }

  apply(signal: WorkflowAgentBackoffSignal): WorkflowAgentBackoffState {
    const current = this.getStored();
    const policy = AGENT_BACKOFF_FACTORS[signal.kind];
    const now = Date.now();
    const sameRuntimeKind =
      current?.runtimeId === this.runtimeId && current.kind === signal.kind;
    const sameKindActive =
      sameRuntimeKind && Date.parse(current.until) > now;
    const nextFailureCount = sameKindActive
      ? current.failureCount
      : sameRuntimeKind
        ? current.failureCount + 1
        : 1;
    const retryAtMs = signal.retryAt === undefined
      ? Number.NaN
      : new Date(signal.retryAt).getTime();
    const untilMs = sameKindActive
      ? Math.max(Date.parse(current.until), Number.isFinite(retryAtMs) ? retryAtMs : 0)
      : Math.max(
          now + Math.min(
            MAX_AGENT_BACKOFF_MS,
            Math.round(
              policy.initialDelayMs *
                policy.backoffFactor ** (nextFailureCount - 1),
            ),
          ),
          Number.isFinite(retryAtMs) ? retryAtMs : 0,
        );
    if (
      current?.runtimeId === this.runtimeId &&
      Date.parse(current.until) >= untilMs
    ) {
      this.log(
        `Agent dispatch remains backed off until ${new Date(current.until).toLocaleString()} (${current.kind}, attempt ${current.failureCount})`,
      );
      return current;
    }
    const backoff: WorkflowAgentBackoffState = {
      runtimeId: this.runtimeId,
      kind: signal.kind,
      failureCount: nextFailureCount,
      until: new Date(untilMs).toISOString(),
      updatedAt: new Date(now).toISOString(),
      reason: signal.reason,
    };
    this.store.setAgentBackoff(backoff);
    this.log(
      `Agent dispatch backed off until ${new Date(backoff.until).toLocaleString()} (${backoff.kind}, attempt ${backoff.failureCount})`,
    );
    return backoff;
  }

  clear(reason = "after successful agent run"): boolean {
    const backoff = this.getStored();
    if (!backoff) return false;
    this.store.setAgentBackoff(null);
    this.log(
      `Cleared agent dispatch backoff ${reason} (${backoff.kind})`,
    );
    return true;
  }
}

export function workflowAgentRuntimeId(config: KotaConfig | undefined): string {
  const runtime = resolveAgentRuntime(config);
  return `${runtime.preset.id}:${runtime.harness}`;
}
