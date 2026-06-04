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
	formatRelative,
	matchesFilter,
	projectHash,
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
export {
	buildConfiguredProject,
	type ConfiguredProject,
	type ConfiguredProjectInput,
	deriveDirectoryScopeId,
	loadRegistryFileFromDisk,
	type ProjectId,
	type ProjectRegistryProjection,
	resolveConfiguredProjects,
	ScopeRegistry,
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
