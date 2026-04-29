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
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
	getRepoTasksProvider,
	REPO_TASKS_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type {
	RepoTaskListEntry,
	RepoTaskSearchResult,
	RepoTaskState,
	RepoTasksClient,
} from "#core/server/kota-client.js";
import { createRepoTasksReadinessSource } from "./capability-readiness.js";
import { listTasksForStates, registerTaskCommands } from "./cli.js";
import { getRepoTasksDir, moveTaskById } from "./repo-tasks-domain.js";
import {
	captureInboxTask,
	createNormalizedTask,
	gcTerminalTasks,
	showTask,
} from "./repo-tasks-operations.js";
import { RepoTasksDefaultStore } from "./repo-tasks-store.js";
import { taskControlRoutes, taskRoutes } from "./routes.js";

const REPO_TASK_OPEN_STATES: RepoTaskState[] = [
	"backlog",
	"ready",
	"doing",
	"blocked",
];

const DEFAULT_SEARCH_LIMIT = 20;

const repoTasksModule: KotaModule = {
	name: "repo-tasks",
	version: "1.0.0",
	description: "Operator CLI for the KOTA repo task queue",
	dependencies: ["rendering"],

	onLoad: (ctx: ModuleContext) => {
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

	routes: () => taskRoutes(),
	controlRoutes: () => taskControlRoutes(),

	localClient: (ctx) => {
		const handler: RepoTasksClient = {
			async list(states) {
				const tasksDir = getRepoTasksDir(ctx.cwd);
				const wanted = states && states.length > 0 ? states : REPO_TASK_OPEN_STATES;
				const tasks: RepoTaskListEntry[] = listTasksForStates(tasksDir, wanted);
				return { tasks };
			},
			async show(id) {
				return showTask(ctx.cwd, id);
			},
			async move(id, toState) {
				try {
					const result = moveTaskById(ctx.cwd, id, toState);
					return {
						ok: true,
						id: result.id,
						fromState: result.fromState,
						toState: result.toState,
						path: result.path,
						previousPath: result.previousPath,
					};
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					if (/not found/i.test(message)) {
						return { ok: false, reason: "not_found" };
					}
					if (/already in/i.test(message)) {
						return { ok: false, reason: "already_in_state", state: toState };
					}
					throw err;
				}
			},
			async create(options) {
				return createNormalizedTask(ctx.cwd, options);
			},
			async capture(title) {
				return captureInboxTask(ctx.cwd, title);
			},
			async gc(options) {
				return gcTerminalTasks(ctx.cwd, options ?? {});
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
				if (!semantic) {
					const fallback = new RepoTasksDefaultStore(ctx.cwd);
					return { ok: true, tasks: await fallback.searchTasks(query, opts) };
				}
				const provider = getRepoTasksProvider();
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
			async reindex() {
				return getRepoTasksProvider().reindex();
			},
		};
		return { tasks: handler };
	},
};

export default repoTasksModule;
