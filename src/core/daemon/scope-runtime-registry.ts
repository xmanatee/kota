import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { RunCoordinator } from "#core/workflow/run-coordinator.js";
import type { RunStateDatabase } from "#core/workflow/run-state-database.js";
import {
  AgentBackoffManager,
  workflowAgentRuntimeId,
} from "#core/workflow/agent-backoff.js";
import { DaemonAgentBackoffStateStore } from "#core/workflow/scope-runtime-state.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type { QuietHoursConfig } from "./notification-gate.js";
import type { ScopePolicyAuthority } from "./scope-policy.js";
import type {
  DirectoryScope,
  ScopeId,
  ScopeRegistry,
} from "./scope-registry.js";
import {
  createScopeRuntime,
  rebindDefaultScopeRuntime,
  type ScopeRuntime,
  type ScopeRuntimeFactoryOptions,
} from "./scope-runtime.js";

export type ScopeRuntimeRegistryOptions = {
  registry: ScopeRegistry;
  authorityConfigPath?: string;
  bus: EventBus;
  eventJournal?: EventJournal;
  config?: KotaConfig;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
  model?: string;
  idleIntervalMs?: number;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  onLog: (message: string) => void;
  quietHours?: QuietHoursConfig;
  scopePolicyAuthority?: ScopePolicyAuthority;
  runState: RunStateDatabase;
  runCoordinator: RunCoordinator;
  daemonEpoch: number;
};

/** Typed lookup and mutable ownership map for every live scope runtime. */
export class ScopeRuntimeRegistry {
  private readonly byId: Map<ScopeId, ScopeRuntime>;
  private defaultScopeId: ScopeId;
  private readonly factoryOptions: Omit<
    ScopeRuntimeFactoryOptions,
    "scope" | "installSingletons"
  >;

  private constructor(
    byId: Map<ScopeId, ScopeRuntime>,
    defaultScopeId: ScopeId,
    factoryOptions: Omit<ScopeRuntimeFactoryOptions, "scope" | "installSingletons">,
  ) {
    this.byId = byId;
    this.defaultScopeId = defaultScopeId;
    this.factoryOptions = factoryOptions;
  }

  static create(opts: ScopeRuntimeRegistryOptions): ScopeRuntimeRegistry {
    const defaultId = opts.registry.getDefaultScopeId();
    const agentBackoff = new AgentBackoffManager(
      new DaemonAgentBackoffStateStore(opts.runState),
      opts.onLog,
      workflowAgentRuntimeId(opts.config),
    );
    const byId = new Map<ScopeId, ScopeRuntime>();
    for (const scope of opts.registry.list()) {
      const runtime = createScopeRuntime({
        scope,
        authorityConfigPath: opts.authorityConfigPath,
        bus: opts.bus,
        eventJournal: opts.eventJournal,
        config: opts.config,
        workflows: opts.workflows,
        model: opts.model,
        idleIntervalMs: opts.idleIntervalMs,
        resolveAgentDef: opts.resolveAgentDef,
        resolveSkillsPrompt: opts.resolveSkillsPrompt,
        onLog: opts.onLog,
        installSingletons: scope.scopeId === defaultId,
        quietHours: scope.scopeId === defaultId ? opts.quietHours : undefined,
        scopePolicyAuthority: opts.scopePolicyAuthority,
        runState: opts.runState,
        runCoordinator: opts.runCoordinator,
        daemonEpoch: opts.daemonEpoch,
        agentBackoff,
      });
      byId.set(scope.scopeId, runtime);
    }
    return new ScopeRuntimeRegistry(byId, defaultId, {
      authorityConfigPath: opts.authorityConfigPath,
      bus: opts.bus,
      eventJournal: opts.eventJournal,
      config: opts.config,
      workflows: opts.workflows,
      model: opts.model,
      idleIntervalMs: opts.idleIntervalMs,
      resolveAgentDef: opts.resolveAgentDef,
      resolveSkillsPrompt: opts.resolveSkillsPrompt,
      onLog: opts.onLog,
      quietHours: opts.quietHours,
      scopePolicyAuthority: opts.scopePolicyAuthority,
      runState: opts.runState,
      runCoordinator: opts.runCoordinator,
      daemonEpoch: opts.daemonEpoch,
      agentBackoff,
    });
  }

  createDetached(scope: DirectoryScope): ScopeRuntime {
    if (this.byId.has(scope.scopeId)) {
      throw new Error(`ScopeRuntimeRegistry: runtime ${scope.scopeId} already exists`);
    }
    return createScopeRuntime({
      ...this.factoryOptions,
      scope,
      installSingletons: false,
      quietHours: undefined,
    });
  }

  add(runtime: ScopeRuntime): void {
    if (this.byId.has(runtime.scope.scopeId)) {
      throw new Error(
        `ScopeRuntimeRegistry: runtime ${runtime.scope.scopeId} already exists`,
      );
    }
    this.byId.set(runtime.scope.scopeId, runtime);
  }

  updateScope(scope: DirectoryScope): void {
    this.get(scope.scopeId).scope = scope;
  }

  setDefaultScopeId(scopeId: ScopeId): void {
    if (scopeId === this.defaultScopeId) return;
    const previous = this.getDefault();
    const next = this.get(scopeId);
    rebindDefaultScopeRuntime(previous, next, this.factoryOptions.quietHours);
    this.defaultScopeId = scopeId;
  }

  remove(scopeId: ScopeId): ScopeRuntime {
    if (scopeId === this.defaultScopeId) {
      throw new Error("ScopeRuntimeRegistry: the default runtime cannot be removed");
    }
    const runtime = this.get(scopeId);
    this.byId.delete(scopeId);
    return runtime;
  }

  get(scopeId: ScopeId): ScopeRuntime {
    const runtime = this.byId.get(scopeId);
    if (!runtime) {
      throw new Error(`ScopeRuntimeRegistry: no runtime registered for scopeId ${scopeId}`);
    }
    return runtime;
  }

  getDefault(): ScopeRuntime {
    return this.get(this.defaultScopeId);
  }

  getDefaultScopeId(): ScopeId {
    return this.defaultScopeId;
  }

  list(): readonly ScopeRuntime[] {
    return [...this.byId.values()];
  }

  size(): number {
    return this.byId.size;
  }
}
