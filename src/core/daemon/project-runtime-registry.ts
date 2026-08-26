import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { RunCoordinator } from "#core/workflow/run-coordinator.js";
import type { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type { QuietHoursConfig } from "./notification-gate.js";
import {
  createProjectRuntime,
  type ProjectRuntime,
  type ProjectRuntimeFactoryOptions,
  rebindDefaultProjectRuntime,
} from "./project-runtime.js";
import type { ScopePolicyAuthority } from "./scope-policy.js";
import type {
  ConfiguredProject,
  ProjectId,
  ScopeRegistry,
} from "./scope-registry.js";

export type ProjectRuntimeRegistryOptions = {
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
export class ProjectRuntimeRegistry {
  private readonly byId: Map<ProjectId, ProjectRuntime>;
  private defaultProjectId: ProjectId;
  private readonly factoryOptions: Omit<
    ProjectRuntimeFactoryOptions,
    "project" | "installSingletons"
  >;

  private constructor(
    byId: Map<ProjectId, ProjectRuntime>,
    defaultProjectId: ProjectId,
    factoryOptions: Omit<ProjectRuntimeFactoryOptions, "project" | "installSingletons">,
  ) {
    this.byId = byId;
    this.defaultProjectId = defaultProjectId;
    this.factoryOptions = factoryOptions;
  }

  static create(opts: ProjectRuntimeRegistryOptions): ProjectRuntimeRegistry {
    const defaultId = opts.registry.getDefaultProjectId();
    const byId = new Map<ProjectId, ProjectRuntime>();
    for (const project of opts.registry.list()) {
      const runtime = createProjectRuntime({
        project,
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
        installSingletons: project.projectId === defaultId,
        quietHours: project.projectId === defaultId ? opts.quietHours : undefined,
        scopePolicyAuthority: opts.scopePolicyAuthority,
        runState: opts.runState,
        runCoordinator: opts.runCoordinator,
        daemonEpoch: opts.daemonEpoch,
      });
      byId.set(project.projectId, runtime);
    }
    return new ProjectRuntimeRegistry(byId, defaultId, {
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
    });
  }

  createDetached(project: ConfiguredProject): ProjectRuntime {
    if (this.byId.has(project.projectId)) {
      throw new Error(`ProjectRuntimeRegistry: runtime ${project.projectId} already exists`);
    }
    return createProjectRuntime({
      ...this.factoryOptions,
      project,
      installSingletons: false,
      quietHours: undefined,
    });
  }

  add(runtime: ProjectRuntime): void {
    if (this.byId.has(runtime.project.projectId)) {
      throw new Error(
        `ProjectRuntimeRegistry: runtime ${runtime.project.projectId} already exists`,
      );
    }
    this.byId.set(runtime.project.projectId, runtime);
  }

  updateProject(project: ConfiguredProject): void {
    this.get(project.projectId).project = project;
  }

  setDefaultProjectId(projectId: ProjectId): void {
    if (projectId === this.defaultProjectId) return;
    const previous = this.getDefault();
    const next = this.get(projectId);
    rebindDefaultProjectRuntime(previous, next, this.factoryOptions.quietHours);
    this.defaultProjectId = projectId;
  }

  remove(projectId: ProjectId): ProjectRuntime {
    if (projectId === this.defaultProjectId) {
      throw new Error("ProjectRuntimeRegistry: the default runtime cannot be removed");
    }
    const runtime = this.get(projectId);
    this.byId.delete(projectId);
    return runtime;
  }

  get(projectId: ProjectId): ProjectRuntime {
    const runtime = this.byId.get(projectId);
    if (!runtime) {
      throw new Error(`ProjectRuntimeRegistry: no runtime registered for projectId ${projectId}`);
    }
    return runtime;
  }

  getDefault(): ProjectRuntime {
    return this.get(this.defaultProjectId);
  }

  getDefaultProjectId(): ProjectId {
    return this.defaultProjectId;
  }

  list(): readonly ProjectRuntime[] {
    return [...this.byId.values()];
  }

  size(): number {
    return this.byId.size;
  }
}
