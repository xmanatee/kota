import type { EventBus } from "#core/events/event-bus.js";
import type { WorkflowRuntimeInitialDispatch } from "#core/workflow/runtime-lifecycle.js";
import type { ProjectRuntime, ProjectRuntimeRegistry } from "./project-runtime.js";
import type { ScheduledItem } from "./scheduler.js";

type HostedRuntimeResources = {
  stopSchedulerBus: () => void;
  stopSchedulerTimer: () => void;
};

export type ScopeRuntimeHostOptions = {
  bus: EventBus;
  pollIntervalMs: number;
  onDueItems: (runtime: ProjectRuntime, items: ScheduledItem[]) => void;
};

/** Owns every live subscription and timer attached to a scope runtime. */
export class ScopeRuntimeHost {
  private readonly hosted = new Map<string, HostedRuntimeResources>();
  private active = false;

  constructor(private readonly options: ScopeRuntimeHostOptions) {}

  async startInitial(
    registry: ProjectRuntimeRegistry,
    initialDispatch: WorkflowRuntimeInitialDispatch = "active",
  ): Promise<void> {
    if (this.active) return;
    this.active = true;
    const started: ProjectRuntime[] = [];
    try {
      for (const runtime of registry.list()) {
        await this.start(runtime, initialDispatch);
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
    runtime: ProjectRuntime,
    initialDispatch: WorkflowRuntimeInitialDispatch = "active",
  ): Promise<void> {
    const scopeId = runtime.project.projectId;
    if (!this.active) throw new Error("ScopeRuntimeHost is not active");
    if (this.hosted.has(scopeId)) {
      throw new Error(`ScopeRuntimeHost: scope ${scopeId} is already hosted`);
    }

    let stopSchedulerBus = (): void => {};
    let stopSchedulerTimer = (): void => {};
    try {
      runtime.workflowRuntime.validateDefinitions();
      stopSchedulerBus = runtime.scheduler.connectBus(
        this.options.bus,
        (items) => this.options.onDueItems(runtime, items),
      );
      stopSchedulerTimer = runtime.scheduler.startTimer(
        this.options.pollIntervalMs,
        (items) => this.options.onDueItems(runtime, items),
      );
      runtime.workflowRuntime.start(initialDispatch);
      this.hosted.set(scopeId, {
        stopSchedulerBus,
        stopSchedulerTimer,
      });
    } catch (error) {
      stopSchedulerTimer();
      stopSchedulerBus();
      await runtime.workflowRuntime.stop(1, 1_000);
      throw error;
    }
  }

  async stop(
    runtime: ProjectRuntime,
    gracePeriodMs: number,
    abortWaitMs?: number,
  ): Promise<void> {
    const resources = this.hosted.get(runtime.project.projectId);
    if (!resources) return;
    await this.stopWorkflow(runtime, gracePeriodMs, abortWaitMs);
    this.releaseHostedResources(runtime, resources);
  }

  /** Force-detach an uncommitted runtime even when its workflow stop fails. */
  async abortUncommitted(
    runtime: ProjectRuntime,
    gracePeriodMs: number,
    abortWaitMs?: number,
  ): Promise<void> {
    const resources = this.hosted.get(runtime.project.projectId);
    if (!resources) return;
    let stopError: Error | null = null;
    try {
      await this.stopWorkflow(runtime, gracePeriodMs, abortWaitMs);
    } catch (error) {
      stopError = error instanceof Error ? error : new Error(String(error));
    } finally {
      this.releaseHostedResources(runtime, resources);
    }
    if (stopError !== null) throw stopError;
  }

  async stopAll(
    registry: ProjectRuntimeRegistry,
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

  private async stopWorkflow(
    runtime: ProjectRuntime,
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
    runtime: ProjectRuntime,
    resources: HostedRuntimeResources,
  ): void {
    resources.stopSchedulerTimer();
    resources.stopSchedulerBus();
    runtime.notificationGate?.dispose();
    runtime.notificationGate = null;
    this.hosted.delete(runtime.project.projectId);
  }
}
