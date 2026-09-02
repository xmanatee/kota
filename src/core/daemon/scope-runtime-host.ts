import type { EventBus } from "#core/events/event-bus.js";
import type { WorkflowRuntimeInitialDispatch } from "#core/workflow/runtime-lifecycle.js";
import type { ScheduledItem } from "./scheduler.js";
import type { ScopeRuntime, ScopeRuntimeRegistry } from "./scope-runtime.js";

type HostedRuntimeResources = {
  workflowStarted: boolean;
  stopSchedulerBus: () => void;
  stopSchedulerTimer: () => void;
};

export type ScopeRuntimeHostStartMode = WorkflowRuntimeInitialDispatch | "prepared";

export type ScopeRuntimeHostOptions = {
  bus: EventBus;
  pollIntervalMs: number;
  onDueItems: (runtime: ScopeRuntime, items: ScheduledItem[]) => void;
};

/** Owns prepared/active state plus every live subscription and timer for a scope runtime. */
export class ScopeRuntimeHost {
  private readonly hosted = new Map<string, HostedRuntimeResources>();
  private active = false;

  constructor(private readonly options: ScopeRuntimeHostOptions) {}

  async startInitial(
    registry: ScopeRuntimeRegistry,
    mode: ScopeRuntimeHostStartMode = "active",
  ): Promise<void> {
    if (this.active) return;
    this.active = true;
    const started: ScopeRuntime[] = [];
    try {
      for (const runtime of registry.list()) {
        await this.start(runtime, mode);
        started.push(runtime);
      }
    } catch (error) {
      for (const runtime of started.reverse()) {
        await this.stop(runtime, 1, 1_000);
      }
      this.active = false;
      throw error;
    }
  }

  async start(
    runtime: ScopeRuntime,
    mode: ScopeRuntimeHostStartMode = "active",
  ): Promise<void> {
    const scopeId = runtime.scope.scopeId;
    if (!this.active) throw new Error("ScopeRuntimeHost is not active");
    if (this.hosted.has(scopeId)) {
      throw new Error(`ScopeRuntimeHost: scope ${scopeId} is already hosted`);
    }

    runtime.workflowRuntime.validateDefinitions();
    if (mode === "prepared") {
      runtime.workflowRuntime.setDispatchPaused(true);
    }
    this.hosted.set(
      scopeId,
      mode === "prepared"
        ? this.preparedResources()
        : await this.startRuntimeResources(runtime, mode),
    );
  }

  /** Open subscriptions and schedules only after prepared scope authority commits. */
  async activatePrepared(
    runtime: ScopeRuntime,
    initialDispatch: WorkflowRuntimeInitialDispatch = "active",
  ): Promise<void> {
    const scopeId = runtime.scope.scopeId;
    const resources = this.hosted.get(scopeId);
    if (!resources) {
      throw new Error(`ScopeRuntimeHost: scope ${scopeId} is not hosted`);
    }
    if (resources.workflowStarted) {
      throw new Error(`ScopeRuntimeHost: scope ${scopeId} is already active`);
    }
    this.hosted.set(
      scopeId,
      await this.startRuntimeResources(runtime, initialDispatch),
    );
  }

  /** Close an activated onboarding runtime while retaining its prepared registration. */
  async deactivateToPrepared(
    runtime: ScopeRuntime,
    gracePeriodMs: number,
    abortWaitMs?: number,
  ): Promise<void> {
    const scopeId = runtime.scope.scopeId;
    const resources = this.hosted.get(scopeId);
    if (!resources) {
      throw new Error(`ScopeRuntimeHost: scope ${scopeId} is not hosted`);
    }
    if (!resources.workflowStarted) return;

    runtime.workflowRuntime.setDispatchPaused(true);
    try {
      await this.stopWorkflow(runtime, gracePeriodMs, abortWaitMs);
    } finally {
      resources.stopSchedulerTimer();
      resources.stopSchedulerBus();
      this.hosted.set(scopeId, this.preparedResources());
    }
  }

  async stop(
    runtime: ScopeRuntime,
    gracePeriodMs: number,
    abortWaitMs?: number,
  ): Promise<void> {
    const resources = this.hosted.get(runtime.scope.scopeId);
    if (!resources) return;
    if (resources.workflowStarted) {
      await this.stopWorkflow(runtime, gracePeriodMs, abortWaitMs);
    }
    this.releaseHostedResources(runtime, resources);
  }

  /** Force-detach an uncommitted runtime even when its workflow stop fails. */
  async abortUncommitted(
    runtime: ScopeRuntime,
    gracePeriodMs: number,
    abortWaitMs?: number,
  ): Promise<void> {
    const resources = this.hosted.get(runtime.scope.scopeId);
    if (!resources) return;
    let stopError: Error | null = null;
    try {
      if (resources.workflowStarted) {
        await this.stopWorkflow(runtime, gracePeriodMs, abortWaitMs);
      }
    } catch (error) {
      stopError = error instanceof Error ? error : new Error(String(error));
    } finally {
      this.releaseHostedResources(runtime, resources);
    }
    if (stopError !== null) throw stopError;
  }

  async stopAll(
    registry: ScopeRuntimeRegistry,
    gracePeriodMs: number,
    abortWaitMs?: number,
  ): Promise<void> {
    for (const runtime of [...registry.list()].reverse()) {
      await this.stop(runtime, gracePeriodMs, abortWaitMs);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  isHosted(scopeId: string): boolean {
    return this.hosted.has(scopeId);
  }

  hostedCount(): number {
    return this.hosted.size;
  }

  isPrepared(scopeId: string): boolean {
    const resources = this.hosted.get(scopeId);
    return resources !== undefined && !resources.workflowStarted;
  }

  private preparedResources(): HostedRuntimeResources {
    return {
      workflowStarted: false,
      stopSchedulerBus: () => {},
      stopSchedulerTimer: () => {},
    };
  }

  private async startRuntimeResources(
    runtime: ScopeRuntime,
    initialDispatch: WorkflowRuntimeInitialDispatch,
  ): Promise<HostedRuntimeResources> {
    let stopSchedulerBus = (): void => {};
    let stopSchedulerTimer = (): void => {};
    try {
      stopSchedulerBus = runtime.scheduler.connectBus(
        this.options.bus,
        (items) => this.options.onDueItems(runtime, items),
      );
      stopSchedulerTimer = runtime.scheduler.startTimer(
        this.options.pollIntervalMs,
        (items) => this.options.onDueItems(runtime, items),
      );
      runtime.workflowRuntime.start(initialDispatch);
      return {
        workflowStarted: true,
        stopSchedulerBus,
        stopSchedulerTimer,
      };
    } catch (error) {
      stopSchedulerTimer();
      stopSchedulerBus();
      await runtime.workflowRuntime.stop(1, 1_000);
      throw error;
    }
  }

  private async stopWorkflow(
    runtime: ScopeRuntime,
    gracePeriodMs: number,
    abortWaitMs: number | undefined,
  ): Promise<void> {
    if (abortWaitMs === undefined) {
      await runtime.workflowRuntime.stop(gracePeriodMs);
    } else {
      await runtime.workflowRuntime.stop(gracePeriodMs, abortWaitMs);
    }
  }

  private releaseHostedResources(
    runtime: ScopeRuntime,
    resources: HostedRuntimeResources,
  ): void {
    resources.stopSchedulerTimer();
    resources.stopSchedulerBus();
    runtime.notificationGate?.dispose();
    runtime.notificationGate = null;
    this.hosted.delete(runtime.scope.scopeId);
  }
}
