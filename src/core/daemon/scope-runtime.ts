/**
 * ScopeRuntime — directory-scope runtime bundle.
 *
 * The {@link ScopeRegistry} primitive names every configured directory scope;
 * this file constructs and holds the runtime each directory entry needs. One
 * bundle owns one scope's workflow runtime, run store, task store, scheduler,
 * module-log store, approval queue, owner-question queue, push-token store
 * path, and (when configured) notification gate.
 *
 * The bundle factory is the single declared place where these per-scope
 * subsystems are constructed. The companion {@link
 * isAllowedSingletonBindingPath} predicate and the
 * `scope-runtime.test.ts` invariant test reject any future binding that
 * skips this factory and reaches `new XStore(scopeRoot)` /
 * `init*(scopeRoot)` from somewhere else in the daemon source tree.
 *
 * The default directory scope's bundle installs the process-owned singletons
 * (`getTaskStore` / `getScheduler` / etc.) for consumers that have not yet
 * moved to host-owned lifecycle injection. Non-default directory
 * bundles intentionally do not touch the singletons.
 */

import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import { getScopeSecretStore, type SecretStore } from "#core/config/secrets.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import { ScopedEventBus } from "#core/events/scope.js";
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
  scopedDeadLetterChangedPublisher,
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
import type { DirectoryScope } from "./scope-registry.js";
import { setTaskStoreInstance, TaskStore } from "./task-store.js";

/**
 * Directory-scope runtime bundle. Each field is scope-scoped: file paths and
 * in-memory state cannot leak across scopes because the bundle holds one
 * dedicated instance per registered directory root.
 *
 * `pbus` is the {@link ScopedEventBus} every scoped emitter
 * inside this bundle uses (TaskStore, Scheduler, ApprovalQueue,
 * OwnerQuestionQueue, NotificationGate, WorkflowRuntime). It wraps the
 * shared daemon bus and injects the stable `scopeId` on every emit so
 * cross-scope subscribers can filter without
 * inferring from paths.
 *
 * `notificationGate` is genuinely optional — quiet-hours is a daemon-level
 * config; non-default bundles leave the slot at `null` because each
 * scope would otherwise need its own quiet-hours config. `null` is the
 * actual domain state, not a fall-through to a global.
 */
export type ScopeRuntime = {
  scope: DirectoryScope;
  /** Machine-owned config document used for this runtime's trust decision. */
  readonly authorityConfigPath?: string;
  readonly pbus: ScopedEventBus;
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
  /** Absolute path to this scope's `push-tokens.json`. */
  readonly pushTokenStorePath: string;
  setDefaultScopeRuntime(isDefault: boolean): void;
  notificationGate: NotificationGate | null;
};

export type ScopeRuntimeFactoryOptions = {
  scope: DirectoryScope;
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
   * When true, the freshly built per-scope instances are also installed
   * as the process-level singletons (`getTaskStore`, `getScheduler`,
   * `getApprovalQueue`, `getOwnerQuestionQueue`, `getModuleLogStore`).
   * Exactly one bundle per daemon should pass `true` — the default
   * scope. Other bundles must leave the singletons untouched.
   */
  installSingletons: boolean;
  /** Quiet-hours config; only honored on the default bundle. */
  quietHours?: QuietHoursConfig;
  scopePolicyAuthority?: ScopePolicyAuthority;
  runState: RunStateDatabase;
  runCoordinator: RunCoordinator;
  daemonEpoch: number;
};

function installScopeRuntimeSingletons(runtime: ScopeRuntime): void {
  setTaskStoreInstance(runtime.taskStore);
  setSchedulerInstance(runtime.scheduler);
  setModuleLogStoreInstance(runtime.moduleLogStore);
  setApprovalQueueInstance(runtime.approvalQueue);
  setIdempotencyStoreInstance(runtime.idempotencyStore);
  setOwnerDecisionStoreInstance(runtime.ownerDecisionStore);
  setOwnerQuestionQueueInstance(runtime.ownerQuestionQueue);
}

/** Move default-only singleton and notification ownership between live scopes. */
export function rebindDefaultScopeRuntime(
  previous: ScopeRuntime,
  next: ScopeRuntime,
  quietHours?: QuietHoursConfig,
): void {
  previous.setDefaultScopeRuntime(false);
  previous.notificationGate?.dispose();
  previous.notificationGate = null;
  next.setDefaultScopeRuntime(true);
  installScopeRuntimeSingletons(next);
  if (quietHours) next.notificationGate = new NotificationGate(next.pbus, quietHours);
}

/**
 * Construct one scope's runtime bundle. This is the canonical (and only)
 * place in the daemon source tree where per-scope stores are built.
 */
export function createScopeRuntime(
  opts: ScopeRuntimeFactoryOptions,
): ScopeRuntime {
  const scopeRoot = opts.scope.scopeRoot;
  const pbus = new ScopedEventBus(opts.bus, opts.scope.scopeId);
  let isDefaultScopeRuntime = opts.installSingletons;

  const runStore = new WorkflowRunStore(scopeRoot);
  const taskStore = new TaskStore(scopeRoot, undefined, pbus);
  const scheduler = new Scheduler(scopeRoot, undefined, pbus);
  const moduleLogStore = new ModuleLogStore(scopeRoot);
  const approvalQueue = new ApprovalQueue(
    join(scopeRoot, ".kota", "approvals"),
    pbus,
    { defaultTtlMs: opts.config?.approvalTtlMs },
  );
  const secretStore = getScopeSecretStore(scopeRoot);
  const deadLetterQueue = new EventedDeadLetterQueueStore(
    join(scopeRoot, ".kota", "dead-letter-queue"),
    undefined,
    scopedDeadLetterChangedPublisher(pbus),
  );
  const idempotencyStore = new IdempotencyStore(
    join(scopeRoot, ".kota", "idempotency"),
    opts.scope.scopeId,
  );
  const ownerDecisionStore = new OwnerDecisionStore(
    join(scopeRoot, ".kota", "owner-decisions"),
    opts.scope.scopeId,
    pbus,
  );
  const ownerQuestionQueue = new OwnerQuestionQueue(
    join(scopeRoot, ".kota", "owner-questions"),
    pbus,
  );

  const workflowRuntime = new WorkflowRuntime({
    bus: opts.bus,
    pbus,
    scopeRoot: scopeRoot,
    scopeId: opts.scope.scopeId,
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

  const runtime: ScopeRuntime = {
    scope: opts.scope,
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
    pushTokenStorePath: join(scopeRoot, ".kota", "push-tokens.json"),
    setDefaultScopeRuntime: (isDefault) => {
      isDefaultScopeRuntime = isDefault;
    },
    notificationGate,
  };
  if (opts.installSingletons) installScopeRuntimeSingletons(runtime);
  return runtime;
}

export { ScopeRuntimeRegistry } from "./scope-runtime-registry.js";
