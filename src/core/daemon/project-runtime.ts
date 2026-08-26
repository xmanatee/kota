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
import { getProjectSecretStore, type SecretStore } from "#core/config/secrets.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { ModuleLogStore, setModuleLogStoreInstance } from "#core/modules/module-log.js";
import type { RunCoordinator } from "#core/workflow/run-coordinator.js";
import type { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { ApprovalQueue, setApprovalQueueInstance } from "./approval-queue.js";
import type { DeadLetterQueueStore } from "./dead-letter-queue.js";
import {
  EventedDeadLetterQueueStore,
  projectScopedDeadLetterChangedPublisher,
} from "./dead-letter-queue-events.js";
import { setIdempotencyStoreInstance } from "./idempotency-singleton.js";
import { IdempotencyStore } from "./idempotency-store.js";
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
import type { ScopePolicyAuthority } from "./scope-policy.js";
import type { ConfiguredProject } from "./scope-registry.js";
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
  project: ConfiguredProject;
  /** Machine-owned config document used for this runtime's trust decision. */
  readonly authorityConfigPath?: string;
  readonly pbus: ProjectScopedEventBus;
  readonly runStore: WorkflowRunStore;
  readonly runState: RunStateDatabase;
  readonly taskStore: TaskStore;
  readonly scheduler: Scheduler;
  readonly moduleLogStore: ModuleLogStore;
  readonly approvalQueue: ApprovalQueue;
  readonly secretStore: SecretStore;
  readonly deadLetterQueue: DeadLetterQueueStore;
  readonly idempotencyStore: IdempotencyStore;
  readonly ownerDecisionStore: OwnerDecisionStore;
  readonly ownerQuestionQueue: OwnerQuestionQueue;
  readonly workflowRuntime: WorkflowRuntime;
  readonly scopePolicyAuthority?: ScopePolicyAuthority;
  /** Absolute path to this project's `push-tokens.json`. */
  readonly pushTokenStorePath: string;
  setDefaultScopeRuntime(isDefault: boolean): void;
  notificationGate: NotificationGate | null;
};

export type ProjectRuntimeFactoryOptions = {
  project: ConfiguredProject;
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
  scopePolicyAuthority?: ScopePolicyAuthority;
  runState: RunStateDatabase;
  runCoordinator: RunCoordinator;
  daemonEpoch: number;
};

function installProjectRuntimeSingletons(runtime: ProjectRuntime): void {
  setTaskStoreInstance(runtime.taskStore);
  setSchedulerInstance(runtime.scheduler);
  setModuleLogStoreInstance(runtime.moduleLogStore);
  setApprovalQueueInstance(runtime.approvalQueue);
  setIdempotencyStoreInstance(runtime.idempotencyStore);
  setOwnerDecisionStoreInstance(runtime.ownerDecisionStore);
  setOwnerQuestionQueueInstance(runtime.ownerQuestionQueue);
}

/** Move default-only singleton and notification ownership between live scopes. */
export function rebindDefaultProjectRuntime(
  previous: ProjectRuntime,
  next: ProjectRuntime,
  quietHours?: QuietHoursConfig,
): void {
  previous.setDefaultScopeRuntime(false);
  previous.notificationGate?.dispose();
  previous.notificationGate = null;
  next.setDefaultScopeRuntime(true);
  installProjectRuntimeSingletons(next);
  if (quietHours) next.notificationGate = new NotificationGate(next.pbus, quietHours);
}

/**
 * Construct one project's runtime bundle. This is the canonical (and only)
 * place in the daemon source tree where per-project stores are built.
 */
export function createProjectRuntime(
  opts: ProjectRuntimeFactoryOptions,
): ProjectRuntime {
  const projectDir = opts.project.projectDir;
  const pbus = new ProjectScopedEventBus(opts.bus, opts.project.projectId);
  let isDefaultScopeRuntime = opts.installSingletons;

  const runStore = new WorkflowRunStore(projectDir);
  const taskStore = new TaskStore(projectDir, undefined, pbus);
  const scheduler = new Scheduler(projectDir, undefined, pbus);
  const moduleLogStore = new ModuleLogStore(projectDir);
  const approvalQueue = new ApprovalQueue(
    join(projectDir, ".kota", "approvals"),
    pbus,
    { defaultTtlMs: opts.config?.approvalTtlMs },
  );
  const secretStore = getProjectSecretStore(projectDir);
  const deadLetterQueue = new EventedDeadLetterQueueStore(
    join(projectDir, ".kota", "dead-letter-queue"),
    undefined,
    projectScopedDeadLetterChangedPublisher(pbus),
  );
  const idempotencyStore = new IdempotencyStore(
    join(projectDir, ".kota", "idempotency"),
    opts.project.projectId,
  );
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
    projectId: opts.project.projectId,
    runState: opts.runState,
    runCoordinator: opts.runCoordinator,
    daemonEpoch: opts.daemonEpoch,
    authorityConfigPath: opts.authorityConfigPath,
    runStore,
    config: opts.config,
    deadLetterQueue,
    eventJournal: opts.eventJournal,
    approvalQueue,
    idempotencyStore,
    workflows: opts.workflows,
    model: opts.model,
    idleIntervalMs: opts.idleIntervalMs,
    onLog: opts.onLog,
    resolveAgentDef: opts.resolveAgentDef,
    resolveSkillsPrompt: opts.resolveSkillsPrompt,
    isDefaultScopeRuntime: () => isDefaultScopeRuntime,
    scopePolicyAuthority: opts.scopePolicyAuthority,
  });

  const notificationGate =
    opts.installSingletons && opts.quietHours
      ? new NotificationGate(pbus, opts.quietHours)
      : null;

  const runtime: ProjectRuntime = {
    project: opts.project,
    ...(opts.authorityConfigPath !== undefined
      ? { authorityConfigPath: opts.authorityConfigPath }
      : {}),
    pbus,
    runStore,
    runState: opts.runState,
    taskStore,
    scheduler,
    moduleLogStore,
    approvalQueue,
    secretStore,
    deadLetterQueue,
    idempotencyStore,
    ownerDecisionStore,
    ownerQuestionQueue,
    workflowRuntime,
    scopePolicyAuthority: opts.scopePolicyAuthority,
    pushTokenStorePath: join(projectDir, ".kota", "push-tokens.json"),
    setDefaultScopeRuntime: (isDefault) => {
      isDefaultScopeRuntime = isDefault;
    },
    notificationGate,
  };
  if (opts.installSingletons) installProjectRuntimeSingletons(runtime);
  return runtime;
}

export { ProjectRuntimeRegistry } from "./project-runtime-registry.js";
