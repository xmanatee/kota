/**
 * Repo-tasks module — owns KOTA's task-queue domain.
 *
 * Ships the `kota task` CLI subcommands, the `/api/tasks` HTTP routes, the
 * `RepoTasksProvider` default keyword implementation, and the domain model
 * (state constants, path helpers, queue snapshot, task-status response shape)
 * in `repo-tasks-domain.ts`.
 */

import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
	getRepoTasksProvider,
	REPO_TASKS_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type { RepoTasksProvider } from "#core/modules/provider-types.js";
import { createRepoTasksReadinessSource } from "./capability-readiness.js";
import { listTasksForStates, registerTaskCommands } from "./cli.js";
import type {
	RepoTaskListEntry,
	RepoTaskSearchResult,
	RepoTaskState,
	RepoTasksClient,
} from "./client.js";
import { buildRepoTasksDaemonHandler } from "./daemon-client.js";
import {
	createRepoTasksProjectStores,
	type RepoTasksProjectStores,
} from "./project-scope.js";
import { mutateRepoTask } from "./repo-task-mutation-boundary.js";
import { getRepoTasksDir } from "./repo-tasks-domain.js";
import { showTask } from "./repo-tasks-operations.js";
import { RepoTasksDefaultStore } from "./repo-tasks-store.js";
import { taskControlRoutes, taskRoutes } from "./routes.js";
import { repoTasksUiSurfaceSource } from "./ui-surface.js";

const REPO_TASK_OPEN_STATES: RepoTaskState[] = [
	"backlog",
	"ready",
	"doing",
	"blocked",
];

const DEFAULT_SEARCH_LIMIT = 20;

function resolveRepoTasksProject(
	projectStores: RepoTasksProjectStores,
	projectId: string | undefined,
) {
	const resolved = projectStores.resolve(projectId);
	if (!resolved.ok) {
		throw new Error(`Unknown project: ${resolved.error.projectId}`);
	}
	return resolved;
}

function createLocalDefaultProviderResolver(
	defaultProjectDir: string,
): () => RepoTasksProvider {
	const fallback = new RepoTasksDefaultStore(defaultProjectDir);
	return () => {
		try {
			return getRepoTasksProvider();
		} catch {
			return fallback;
		}
	};
}

const repoTasksModule: KotaModule = {
	name: "repo-tasks",
	version: "1.0.0",
	description: "Operator CLI for the KOTA repo task queue",
	dependencies: ["rendering"],
	uiSurfaces: [repoTasksUiSurfaceSource],

	onLoad: (ctx: ModuleRuntimeContext) => {
		ctx.registerProvider(REPO_TASKS_PROVIDER_TOKEN, new RepoTasksDefaultStore(ctx.cwd));
		ctx.registerProvider(
			CAPABILITY_READINESS_PROVIDER_TYPE,
			createRepoTasksReadinessSource(() => getRepoTasksProvider()),
		);
	},

	commands: (ctx) => {
		const root = new Command("__root__");
		registerTaskCommands(root, ctx);
		return root.commands as Command[];
	},

	routes: (ctx) =>
		taskRoutes(
			createRepoTasksProjectStores(ctx.cwd, () => getRepoTasksProvider()),
		),
	controlRoutes: (ctx) =>
		taskControlRoutes(
			createRepoTasksProjectStores(ctx.cwd, () => getRepoTasksProvider()),
		),

	localClient: (ctx) => {
		const projectStores = createRepoTasksProjectStores(
			ctx.cwd,
			createLocalDefaultProviderResolver(ctx.cwd),
		);
		const handler: RepoTasksClient = {
			async list(states, project) {
				const resolved = resolveRepoTasksProject(projectStores, project?.projectId);
				const tasksDir = getRepoTasksDir(resolved.projectDir);
				const wanted = states && states.length > 0 ? states : REPO_TASK_OPEN_STATES;
				const tasks: RepoTaskListEntry[] = listTasksForStates(tasksDir, wanted);
				return { tasks };
			},
			async show(id, project) {
				const resolved = resolveRepoTasksProject(projectStores, project?.projectId);
				return showTask(resolved.projectDir, id);
			},
			async move(id, toState, project) {
				const resolved = resolveRepoTasksProject(projectStores, project?.projectId);
				return await mutateRepoTask(resolved, {
					kind: "move",
					id,
					state: toState,
				});
			},
			async updateBody(id, body, project) {
				const resolved = resolveRepoTasksProject(projectStores, project?.projectId);
				return await mutateRepoTask(resolved, { kind: "update-body", id, body });
			},
			async create(options) {
				const { projectId, ...taskOptions } = options;
				const resolved = resolveRepoTasksProject(projectStores, projectId);
				return await mutateRepoTask(resolved, { kind: "create", options: taskOptions });
			},
			async capture(title, project) {
				const resolved = resolveRepoTasksProject(projectStores, project?.projectId);
				return await mutateRepoTask(resolved, { kind: "capture", title });
			},
			async gc(options) {
				const { projectId, ...gcOptions } = options ?? {};
				const resolved = resolveRepoTasksProject(projectStores, projectId);
				return await mutateRepoTask(resolved, { kind: "gc", options: gcOptions });
			},
			async search(query, filter): Promise<RepoTaskSearchResult> {
				const semantic = filter?.semantic !== false;
				const limit = filter?.limit ?? DEFAULT_SEARCH_LIMIT;
				const opts: { topK: number; states?: ReadonlyArray<RepoTaskState> } = {
					topK: limit,
				};
				if (filter?.states && filter.states.length > 0) {
					opts.states = filter.states;
				}
				const resolved = resolveRepoTasksProject(projectStores, filter?.projectId);
				if (!semantic) {
					const fallback = new RepoTasksDefaultStore(resolved.projectDir);
					return { ok: true, tasks: await fallback.searchTasks(query, opts) };
				}
				const provider = resolved.store;
				if (!provider.supportsSemanticSearch()) {
					return { ok: false, reason: "semantic_unavailable" };
				}
				try {
					const tasks = await provider.searchTasks(query, opts);
					return { ok: true, tasks };
				} catch {
					return { ok: false, reason: "semantic_unavailable" };
				}
			},
			async reindex(project) {
				const resolved = resolveRepoTasksProject(projectStores, project?.projectId);
				return resolved.store.reindex();
			},
		};
		return { tasks: handler };
	},
	daemonClient: (link) => ({ tasks: buildRepoTasksDaemonHandler(link) }),
};

export default repoTasksModule;
