import type { KotaConfig } from "#core/config/config.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import type { AgentBackoffStateStore } from "./scope-runtime-state.js";
import type {
  WorkflowAgentBackoffSignal,
  WorkflowAgentBackoffState,
  WorkflowAgentIncidentSignal,
  WorkflowAgentOperatingState,
  WorkflowProviderBackoffState,
} from "./trigger-types.js";

const MAX_AGENT_BACKOFF_MS = 6 * 60 * 60 * 1000;
export const AGENT_BACKOFF_OPERATOR_RETRY_UNTIL = "9999-12-31T23:59:59.999Z";
const AGENT_BACKOFF_FACTORS: Record<
  WorkflowAgentBackoffState["kind"],
  { initialDelayMs: number; backoffFactor: number }
> = {
  rate_limit: { initialDelayMs: 30 * 60 * 1000, backoffFactor: 2 },
  auth: { initialDelayMs: 30 * 60 * 1000, backoffFactor: 2 },
  provider: { initialDelayMs: 5 * 60 * 1000, backoffFactor: 2 },
  runtime: { initialDelayMs: 30 * 60 * 1000, backoffFactor: 2 },
  output_contract: { initialDelayMs: 6 * 60 * 60 * 1000, backoffFactor: 1 },
  quality: { initialDelayMs: 6 * 60 * 60 * 1000, backoffFactor: 1 },
};

export class AgentBackoffAdmissionError extends Error {
  constructor(
    readonly backoff: WorkflowAgentBackoffState,
    readonly incidentSignal?: WorkflowAgentBackoffSignal,
  ) {
    super(
      `Agent dispatch is backed off until ${agentBackoffQueueUntil(backoff)} (${backoff.kind}): ${backoff.reason}`,
    );
    this.name = "AgentBackoffAdmissionError";
  }
}

export class AgentBackoffManager {
  private readonly activeAttempts = new Map<
    AbortController,
    { count: number; scopeId: string }
  >();

  constructor(
    private readonly store: AgentBackoffStateStore,
    private readonly log: (msg: string) => void,
    private readonly runtimeId: string,
  ) {}

  private getStored(): WorkflowAgentBackoffState | null {
    return this.store.getAgentBackoff();
  }

  getActive(): WorkflowAgentBackoffState | null {
    return activeAgentBackoffForRuntime(this.getStored(), this.runtimeId);
  }

  getSupersededRuntime(): WorkflowAgentBackoffState | null {
    const backoff = this.getStored();
    if (!backoff || backoff.runtimeId === this.runtimeId) return null;
    return backoff;
  }

  getRuntimeId(): string {
    return this.runtimeId;
  }

  registerAttempt(abortController: AbortController, scopeId = "unscoped"): () => void {
    const active = this.getActive();
    if (active !== null) {
      const error = new AgentBackoffAdmissionError(active);
      abortController.abort(error);
      throw error;
    }
    const activeAttempt = this.activeAttempts.get(abortController);
    if (activeAttempt !== undefined && activeAttempt.scopeId !== scopeId) {
      throw new Error("One agent attempt cannot belong to multiple scopes");
    }
    this.activeAttempts.set(abortController, {
      count: (activeAttempt?.count ?? 0) + 1,
      scopeId,
    });
    return () => {
      const remaining = (this.activeAttempts.get(abortController)?.count ?? 1) - 1;
      if (remaining === 0) this.activeAttempts.delete(abortController);
      else this.activeAttempts.set(abortController, { count: remaining, scopeId });
    };
  }

  hasActiveAttempt(scopeId: string): boolean {
    return [...this.activeAttempts.values()].some((attempt) =>
      attempt.scopeId === scopeId
    );
  }

  private suppressActiveAttempts(backoff: WorkflowAgentBackoffState): void {
    const error = new AgentBackoffAdmissionError(backoff);
    for (const attempt of this.activeAttempts.keys()) attempt.abort(error);
    this.activeAttempts.clear();
  }

  apply(signal: WorkflowAgentIncidentSignal): WorkflowAgentBackoffState {
    const current = this.getStored();
    if (
      current?.runtimeId === this.runtimeId &&
      (current.kind === "quality" || current.kind === "output_contract") &&
      signal.kind !== "quality" && signal.kind !== "output_contract"
    ) {
      const retained = this.nextProviderIncident(
        signal,
        current.retainedProviderIncident,
      );
      const backoff = {
        ...current,
        retainedProviderIncident: retained,
      };
      this.store.setAgentBackoff(backoff);
      this.log(
        `Agent dispatch remains quality-paused; retained ${retained.kind} recovery until ${new Date(retained.until).toLocaleString()}`,
      );
      this.suppressActiveAttempts(backoff);
      return backoff;
    }
    if (
      current?.runtimeId === this.runtimeId &&
      ((current.kind === "quality" && signal.kind !== "quality") ||
        (current.kind === "output_contract" &&
          signal.kind !== "output_contract" && signal.kind !== "quality"))
    ) {
      this.log(
        `Agent dispatch remains quality-paused until explicit operator retry (${current.reason})`,
      );
      this.suppressActiveAttempts(current);
      return current;
    }
    const policy = AGENT_BACKOFF_FACTORS[signal.kind];
    const now = Date.now();
    const sameRuntimeKind =
      current?.runtimeId === this.runtimeId && current.kind === signal.kind;
    const sameKindActive = sameRuntimeKind &&
      (current.kind === "output_contract" || current.kind === "quality" ||
        Date.parse(current.until) > now);
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
      (current.kind === signal.kind ||
        (signal.kind !== "output_contract" && signal.kind !== "quality")) &&
      Date.parse(current.until) >= untilMs
    ) {
      this.log(
        `Agent dispatch remains backed off until ${new Date(current.until).toLocaleString()} (${current.kind}, attempt ${current.failureCount})`,
      );
      this.suppressActiveAttempts(current);
      return current;
    }
    const backoff: WorkflowAgentBackoffState = {
      runtimeId: this.runtimeId,
      kind: signal.kind,
      failureCount: nextFailureCount,
      until: new Date(untilMs).toISOString(),
      updatedAt: new Date(now).toISOString(),
      reason: signal.reason,
      ...((signal.kind === "quality" || signal.kind === "output_contract") &&
          current?.runtimeId === this.runtimeId &&
          current.kind !== "quality" && current.kind !== "output_contract" &&
          Date.parse(current.until) > now
        ? { retainedProviderIncident: providerIncident(current) }
        : current?.retainedProviderIncident === undefined
          ? {}
          : { retainedProviderIncident: current.retainedProviderIncident }),
    };
    this.store.setAgentBackoff(backoff);
    this.log(
      `Agent dispatch backed off until ${new Date(backoff.until).toLocaleString()} (${backoff.kind}, attempt ${backoff.failureCount})`,
    );
    this.suppressActiveAttempts(backoff);
    return backoff;
  }

  clear(reason = "after successful agent run"): boolean {
    const backoff = this.getStored();
    if (!backoff) return false;
    if (
      backoff.runtimeId === this.runtimeId &&
      backoff.kind !== "quality" && backoff.kind !== "output_contract" &&
      Date.parse(backoff.until) > Date.now()
    ) {
      this.log(
        `Agent dispatch backoff remains active until ${new Date(backoff.until).toLocaleString()} despite ${reason} (${backoff.kind})`,
      );
      return false;
    }
    const retained = backoff.retainedProviderIncident;
    const restored = retained?.runtimeId === this.runtimeId &&
        Date.parse(retained.until) > Date.now()
      ? retained
      : null;
    this.store.setAgentBackoff(restored);
    this.log(
      restored === null
        ? `Cleared agent dispatch backoff ${reason} (${backoff.kind})`
        : `Cleared agent dispatch ${backoff.kind} pause ${reason}; ${restored.kind} backoff remains until ${new Date(restored.until).toLocaleString()}`,
    );
    return true;
  }

  private nextProviderIncident(
    signal: WorkflowAgentIncidentSignal,
    current: WorkflowProviderBackoffState | undefined,
  ): WorkflowProviderBackoffState {
    if (signal.kind === "quality" || signal.kind === "output_contract") {
      throw new Error(`Cannot retain ${signal.kind} as a provider incident`);
    }
    const policy = AGENT_BACKOFF_FACTORS[signal.kind];
    const now = Date.now();
    const sameKind = current?.runtimeId === this.runtimeId &&
      current.kind === signal.kind;
    const active = sameKind && Date.parse(current.until) > now;
    const failureCount = active ? current.failureCount : sameKind
      ? current.failureCount + 1
      : 1;
    const retryAtMs = signal.retryAt === undefined
      ? Number.NaN
      : Date.parse(signal.retryAt);
    const untilMs = active
      ? Math.max(Date.parse(current.until), Number.isFinite(retryAtMs) ? retryAtMs : 0)
      : Math.max(
          now + Math.min(
            MAX_AGENT_BACKOFF_MS,
            Math.round(
              policy.initialDelayMs * policy.backoffFactor ** (failureCount - 1),
            ),
          ),
          Number.isFinite(retryAtMs) ? retryAtMs : 0,
        );
    const candidate: WorkflowProviderBackoffState = {
      runtimeId: this.runtimeId,
      kind: signal.kind,
      failureCount,
      until: new Date(untilMs).toISOString(),
      updatedAt: new Date(now).toISOString(),
      reason: signal.reason,
    };
    return current?.runtimeId === this.runtimeId &&
        Date.parse(current.until) > now &&
        Date.parse(current.until) >= Date.parse(candidate.until)
      ? current
      : candidate;
  }
}

function providerIncident(
  state: WorkflowAgentBackoffState,
): WorkflowProviderBackoffState {
  if (state.kind === "quality" || state.kind === "output_contract") {
    throw new Error(`Cannot retain ${state.kind} as a provider incident`);
  }
  const { retainedProviderIncident: _ignored, ...incident } = state;
  return incident as WorkflowProviderBackoffState;
}

export function activeAgentBackoffForRuntime(
  backoff: WorkflowAgentBackoffState | null,
  runtimeId: string,
  now = Date.now(),
): WorkflowAgentBackoffState | null {
  if (backoff === null || backoff.runtimeId !== runtimeId) return null;
  return backoff.kind === "output_contract" || backoff.kind === "quality" ||
      Date.parse(backoff.until) > now
    ? backoff
    : null;
}

export function workflowAgentRuntimeId(config: KotaConfig | undefined): string {
  const runtime = resolveAgentRuntime(config);
  return `${runtime.preset.id}:${runtime.harness}`;
}

export function agentBackoffQueueUntil(
  backoff: WorkflowAgentBackoffState,
): string {
  return backoff.kind === "output_contract" || backoff.kind === "quality"
    ? AGENT_BACKOFF_OPERATOR_RETRY_UNTIL
    : backoff.until;
}

export function resolveAgentOperatingState(input: {
  runtimeId: string;
  backoff: WorkflowAgentBackoffState | null;
  hasActiveAgentAttempt: boolean;
}): WorkflowAgentOperatingState {
  if (input.backoff?.kind === "output_contract" || input.backoff?.kind === "quality") {
    return {
      runtimeId: input.runtimeId,
      state: "quality-paused",
      reason: input.backoff.reason,
    };
  }
  if (input.backoff?.kind === "rate_limit") {
    return {
      runtimeId: input.runtimeId,
      state: "quota-parked",
      reason: input.backoff.reason,
      resumeAt: input.backoff.until,
    };
  }
  if (input.backoff !== null) {
    return {
      runtimeId: input.runtimeId,
      state: "provider-parked",
      reason: input.backoff.reason,
      resumeAt: input.backoff.until,
    };
  }
  return {
    runtimeId: input.runtimeId,
    state: input.hasActiveAgentAttempt ? "working" : "idle",
  };
}
