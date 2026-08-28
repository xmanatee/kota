/**
 * Scheduler subsystem — scheduling, task management, daemon mode,
 * and task routing.
 */

export {
	Daemon,
	type DaemonConfig,
	type DaemonState,
	RESTART_EXIT_CODE,
} from "./daemon.js";
export {
	LifecycleCollector,
} from "./lifecycle-collector.js";
export type {
	LifecycleCandidate,
	LifecycleCandidateDecision,
	LifecycleCollectorDeps,
	LifecycleScopeStores,
	LifecycleStatusOptions,
	LifecycleStatusReport,
	LifecycleStoreName,
	LifecycleSweepOptions,
	LifecycleSweepReport,
	StoreReclamationSummary,
} from "./lifecycle-collector-types.js";
export {
	formatRelative,
	matchesFilter,
	scopeHash,
} from "./schedule-parser.js";
export {
	getScheduler,
	initScheduler,
	parseRepeat,
	parseTime,
	resetScheduler,
	type ScheduledItem,
	Scheduler,
	setSchedulerInstance,
} from "./scheduler.js";
export type {
	ResolvedScopePolicy,
	RestrictiveScopePolicyChange,
	RestrictiveScopePolicyChangeListener,
	ScopePolicyAuthority,
	ScopePolicyDecision,
	ScopePolicyFragment,
	ScopePolicyRouteResponse,
	ScopePolicySnapshot,
} from "./scope-policy.js";
export {
	decideScopePolicy,
	defaultScopePolicyDecisionExamples,
	resolveScopePolicy,
	ScopePolicyValidationError,
} from "./scope-policy.js";
export {
	buildDirectoryScope,
	type DirectoryScope,
	type DirectoryScopeInput,
	deriveDirectoryScopeId,
	loadRegistryFileFromDisk,
	resolveConfiguredScopes,
	type ScopeId,
	ScopeRegistry,
	type ScopeRegistryProjection,
} from "./scope-registry.js";
export {
	formatTaskHint,
	routeTask,
	type TaskRoute,
	type TaskType,
} from "./task-router.js";
export {
	getTaskStore,
	initTaskStore,
	resetTaskStore,
	type Task,
	type TaskPriority,
	type TaskStatus,
	TaskStore,
} from "./task-store.js";

