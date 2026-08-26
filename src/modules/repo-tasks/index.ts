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
import { mutateRepoTask } from "./repo-task-mutation-boundary.js";
import { getRepoTasksDir } from "./repo-tasks-domain.js";
import { showTask } from "./repo-tasks-operations.js";
import { RepoTasksDefaultStore } from "./repo-tasks-store.js";
import { taskControlRoutes, taskRoutes } from "./routes.js";
import {
	createRepoTasksScopeStores,
	type RepoTasksScopeStores,
} from "./scope.js";
import { repoTasksUiSurfaceSource } from "./ui-surface.js";

const REPO_TASK_OPEN_STATES: RepoTaskState[] = [
	"backlog",
	"ready",
	"doing",
	"blocked",
];

const DEFAULT_SEARCH_LIMIT = 20;

function resolveRepoTasksScope(
	scopeStores: RepoTasksScopeStores,
	scopeId: string | undefined,
) {
	const resolved = scopeStores.resolve(scopeId);
	if (!resolved.ok) {
		throw new Error(`Unknown scope: ${resolved.error.scopeId}`);
	}
	return resolved;
}

function createLocalDefaultProviderResolver(
	defaultScopeRoot: string,
): () => RepoTasksProvider {
	const fallback = new RepoTasksDefaultStore(defaultScopeRoot);
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
			createRepoTasksScopeStores(ctx.cwd, () => getRepoTasksProvider()),
		),
	controlRoutes: (ctx) =>
		taskControlRoutes(
			createRepoTasksScopeStores(ctx.cwd, () => getRepoTasksProvider()),
		),

	localClient: (ctx) => {
		const scopeStores = createRepoTasksScopeStores(
			ctx.cwd,
			createLocalDefaultProviderResolver(ctx.cwd),
		);
		const handler: RepoTasksClient = {
			async list(states, scopeSelector) {
				const resolved = resolveRepoTasksScope(scopeStores, scopeSelector?.scopeId);
				const tasksDir = getRepoTasksDir(resolved.scopeRoot);
				const wanted = states && states.length > 0 ? states : REPO_TASK_OPEN_STATES;
				const tasks: RepoTaskListEntry[] = listTasksForStates(tasksDir, wanted);
				return { tasks };
			},
			async show(id, scopeSelector) {
				const resolved = resolveRepoTasksScope(scopeStores, scopeSelector?.scopeId);
				return showTask(resolved.scopeRoot, id);
			},
			async move(id, toState, scopeSelector) {
				const resolved = resolveRepoTasksScope(scopeStores, scopeSelector?.scopeId);
				return await mutateRepoTask(resolved, {
					kind: "move",
					id,
					state: toState,
				});
			},
			async updateBody(id, body, scopeSelector) {
				const resolved = resolveRepoTasksScope(scopeStores, scopeSelector?.scopeId);
				return await mutateRepoTask(resolved, { kind: "update-body", id, body });
			},
			async create(options) {
				const { scopeId, ...taskOptions } = options;
				const resolved = resolveRepoTasksScope(scopeStores, scopeId);
				return await mutateRepoTask(resolved, { kind: "create", options: taskOptions });
			},
			async capture(title, scopeSelector) {
				const resolved = resolveRepoTasksScope(scopeStores, scopeSelector?.scopeId);
				return await mutateRepoTask(resolved, { kind: "capture", title });
			},
			async gc(options) {
				const { scopeId, ...gcOptions } = options ?? {};
				const resolved = resolveRepoTasksScope(scopeStores, scopeId);
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
				const resolved = resolveRepoTasksScope(scopeStores, filter?.scopeId);
				if (!semantic) {
					const fallback = new RepoTasksDefaultStore(resolved.scopeRoot);
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
			async reindex(scopeSelector) {
				const resolved = resolveRepoTasksScope(scopeStores, scopeSelector?.scopeId);
				return resolved.store.reindex();
			},
		};
		return { tasks: handler };
	},
	daemonClient: (link) => ({ tasks: buildRepoTasksDaemonHandler(link) }),
};

export default repoTasksModule;
