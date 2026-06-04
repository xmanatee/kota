/**
 * ProjectRuntime — compatibility-named directory-scope runtime bundle.
 *
 * The {@link ScopeRegistry} primitive names every configured directory scope;
 * this file constructs and holds the runtime each directory entry needs. One
 * bundle owns one scope's workflow runtime, run store, task store, scheduler,
 * module-log store, approval queue, owner-question queue, push-token store
 * path, and (when configured) notification gate.
 *
 * The bundle factory is the single declared place where these per-project
 * subsystems are constructed. The companion {@link
 * isAllowedSingletonBindingPath} predicate and the
 * `project-runtime.test.ts` invariant test reject any future binding that
 * skips this factory and reaches `new XStore(projectDir)` /
 * `init*(projectDir)` from somewhere else in the daemon source tree.
 *
 * The default directory scope's bundle still installs the legacy singletons
 * (`getTaskStore` / `getScheduler` / etc.) so single-project consumers and
 * the modules that read them continue to work unchanged. Non-default directory
 * bundles intentionally do not touch the singletons.
 */

import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { ModuleLogStore, setModuleLogStoreInstance } from "#core/modules/module-log.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { ApprovalQueue, setApprovalQueueInstance } from "./approval-queue.js";
import { NotificationGate, type QuietHoursConfig } from "./notification-gate.js";
import {
  OwnerDecisionStore,
  setOwnerDecisionStoreInstance,
} from "./owner-decision-store.js";
import {
  OwnerQuestionQueue,
  setOwnerQuestionQueueInstance,
} from "./owner-question-queue.js";
import { Scheduler, setSchedulerInstance } from "./scheduler.js";
import type {
  ConfiguredProject,
  ProjectId,
  ScopeRegistry,
} from "./scope-registry.js";
import { setTaskStoreInstance, TaskStore } from "./task-store.js";

/**
 * Directory-scope runtime bundle. Each field is scope-scoped: file paths and
 * in-memory state cannot leak across scopes because the bundle holds one
 * dedicated instance per registered directory root.
 *
 * `pbus` is the {@link ProjectScopedEventBus} every scoped emitter
 * inside this bundle uses (TaskStore, Scheduler, ApprovalQueue,
 * OwnerQuestionQueue, NotificationGate, WorkflowRuntime). It wraps the
 * shared daemon bus and injects stable `scopeId` plus compatibility
 * `projectId` on every emit so cross-scope subscribers can filter without
 * inferring from paths.
 *
 * `notificationGate` is genuinely optional — quiet-hours is a daemon-level
 * config; non-default bundles leave the slot at `null` because each
 * project would otherwise need its own quiet-hours config. `null` is the
 * actual domain state, not a fall-through to a global.
 */
export type ProjectRuntime = {
  readonly project: ConfiguredProject;
  readonly pbus: ProjectScopedEventBus;
  readonly runStore: WorkflowRunStore;
  readonly taskStore: TaskStore;
  readonly scheduler: Scheduler;
  readonly moduleLogStore: ModuleLogStore;
  readonly approvalQueue: ApprovalQueue;
  readonly ownerDecisionStore: OwnerDecisionStore;
  readonly ownerQuestionQueue: OwnerQuestionQueue;
  readonly workflowRuntime: WorkflowRuntime;
  /** Absolute path to this project's `push-tokens.json`. */
  readonly pushTokenStorePath: string;
  notificationGate: NotificationGate | null;
};

export type ProjectRuntimeFactoryOptions = {
  project: ConfiguredProject;
  bus: EventBus;
  config?: KotaConfig;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
  model?: string;
  idleIntervalMs?: number;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  onLog: (message: string) => void;
  /**
   * When true, the freshly built per-project instances are also installed
   * as the legacy module-level singletons (`getTaskStore`, `getScheduler`,
   * `getApprovalQueue`, `getOwnerQuestionQueue`, `getModuleLogStore`).
   * Exactly one bundle per daemon should pass `true` — the default
   * project. Other bundles must leave the singletons untouched.
   */
  installSingletons: boolean;
  /** Quiet-hours config; only honored on the default bundle. */
  quietHours?: QuietHoursConfig;
};

/**
 * Construct one project's runtime bundle. This is the canonical (and only)
 * place in the daemon source tree where per-project stores are built.
 */
export function createProjectRuntime(
  opts: ProjectRuntimeFactoryOptions,
): ProjectRuntime {
  const projectDir = opts.project.projectDir;
  const pbus = new ProjectScopedEventBus(opts.bus, opts.project.projectId);

  const runStore = new WorkflowRunStore(projectDir);
  const taskStore = new TaskStore(projectDir, undefined, pbus);
  const scheduler = new Scheduler(projectDir, undefined, pbus);
  const moduleLogStore = new ModuleLogStore(projectDir);
  const approvalQueue = new ApprovalQueue(join(projectDir, ".kota", "approvals"), pbus);
  const ownerDecisionStore = new OwnerDecisionStore(
    join(projectDir, ".kota", "owner-decisions"),
    opts.project.projectId,
    pbus,
  );
  const ownerQuestionQueue = new OwnerQuestionQueue(
    join(projectDir, ".kota", "owner-questions"),
    pbus,
  );

  const workflowRuntime = new WorkflowRuntime({
    bus: opts.bus,
    pbus,
    projectDir,
    runStore,
    config: opts.config,
    workflows: opts.workflows,
    model: opts.model,
    idleIntervalMs: opts.idleIntervalMs,
    onLog: opts.onLog,
    resolveAgentDef: opts.resolveAgentDef,
    resolveSkillsPrompt: opts.resolveSkillsPrompt,
    agentConcurrency: opts.config?.scheduler?.agentConcurrency,
    codeConcurrency: opts.config?.scheduler?.codeConcurrency,
  });

  if (opts.installSingletons) {
    setTaskStoreInstance(taskStore);
    setSchedulerInstance(scheduler);
    setModuleLogStoreInstance(moduleLogStore);
    setApprovalQueueInstance(approvalQueue);
    setOwnerDecisionStoreInstance(ownerDecisionStore);
    setOwnerQuestionQueueInstance(ownerQuestionQueue);
  }

  const notificationGate =
    opts.installSingletons && opts.quietHours
      ? new NotificationGate(pbus, opts.quietHours)
      : null;

  return {
    project: opts.project,
    pbus,
    runStore,
    taskStore,
    scheduler,
    moduleLogStore,
    approvalQueue,
    ownerDecisionStore,
    ownerQuestionQueue,
    workflowRuntime,
    pushTokenStorePath: join(projectDir, ".kota", "push-tokens.json"),
    notificationGate,
  };
}

/**
 * Typed lookup over every project's runtime bundle. Keyed by stable
 * {@link ProjectId} so consumers never need to resolve a project root path
 * back to a runtime themselves.
 */
export class ProjectRuntimeRegistry {
  private readonly byId: Map<ProjectId, ProjectRuntime>;
  private readonly defaultProjectId: ProjectId;

  private constructor(
    byId: Map<ProjectId, ProjectRuntime>,
    defaultProjectId: ProjectId,
  ) {
    this.byId = byId;
    this.defaultProjectId = defaultProjectId;
  }

  static create(opts: {
    registry: ScopeRegistry;
    bus: EventBus;
    config?: KotaConfig;
    workflows?: readonly RegisteredWorkflowDefinitionInput[];
    model?: string;
    idleIntervalMs?: number;
    resolveAgentDef?: (name: string) => AgentDef | undefined;
    resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
    onLog: (message: string) => void;
    quietHours?: QuietHoursConfig;
  }): ProjectRuntimeRegistry {
    const projects = opts.registry.list();
    const defaultId = opts.registry.getDefaultProjectId();
    const byId = new Map<ProjectId, ProjectRuntime>();
    for (const project of projects) {
      const runtime = createProjectRuntime({
        project,
        bus: opts.bus,
        config: opts.config,
        workflows: opts.workflows,
        model: opts.model,
        idleIntervalMs: opts.idleIntervalMs,
        resolveAgentDef: opts.resolveAgentDef,
        resolveSkillsPrompt: opts.resolveSkillsPrompt,
        onLog: opts.onLog,
        installSingletons: project.projectId === defaultId,
        quietHours: project.projectId === defaultId ? opts.quietHours : undefined,
      });
      byId.set(project.projectId, runtime);
    }
    return new ProjectRuntimeRegistry(byId, defaultId);
  }

  get(projectId: ProjectId): ProjectRuntime {
    const runtime = this.byId.get(projectId);
    if (!runtime) {
      throw new Error(
        `ProjectRuntimeRegistry: no runtime registered for projectId ${projectId}`,
      );
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
}
