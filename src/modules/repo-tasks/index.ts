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
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
	REPO_TASKS_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type { RepoTasksProvider } from "#core/modules/provider-types.js";
import { createRepoTasksReadinessSource } from "./capability-readiness.js";
import { registerTaskCommands } from "./cli.js";
import type { RepoTasksClient } from "./client.js";
import { buildRepoTasksDaemonHandler } from "./daemon-client.js";
import { mutateRepoTask } from "./repo-task-mutation-boundary.js";
import repoTaskMutationWorkflow from "./repo-task-mutation-workflow.js";
import {
	listRepoTasks,
	reindexRepoTasks,
	searchRepoTasks,
	showTask,
} from "./repo-tasks-operations.js";
import { RepoTasksDefaultStore } from "./repo-tasks-store.js";
import { taskControlRoutes, taskRoutes } from "./routes.js";
import {
	createRepoTasksScopeStores,
	type RepoTasksScopeStores,
} from "./scope.js";
import { repoTasksUiSurfaceSource } from "./ui-surface.js";

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
	registered: () => RepoTasksProvider | null,
): () => RepoTasksProvider {
	const fallback = new RepoTasksDefaultStore(defaultScopeRoot);
	return () => {
		return registered() ?? fallback;
	};
}

const repoTasksModule: KotaModule = {
	name: "repo-tasks",
	version: "1.0.0",
	description: "Operator CLI for the KOTA repo task queue",
	dependencies: ["rendering"],
	uiSurfaces: [repoTasksUiSurfaceSource],
	workflows: [repoTaskMutationWorkflow],

	onLoad: (ctx: ModuleRuntimeContext) => {
		ctx.registerProvider(REPO_TASKS_PROVIDER_TOKEN, new RepoTasksDefaultStore(ctx.cwd));
		ctx.registerProvider(
			CAPABILITY_READINESS_PROVIDER_TYPE,
			createRepoTasksReadinessSource(() => {
				const provider = ctx.getProvider(REPO_TASKS_PROVIDER_TOKEN);
				if (!provider) throw new Error("repo-tasks provider is not registered");
				return provider;
			}),
		);
	},

	commands: (ctx) => {
		const root = new Command("__root__");
		registerTaskCommands(root, ctx);
		return root.commands as Command[];
	},

	routes: (ctx) =>
		taskRoutes(
			createRepoTasksScopeStores(ctx.cwd, () => {
				const provider = ctx.getProvider(REPO_TASKS_PROVIDER_TOKEN);
				if (!provider) throw new Error("repo-tasks provider is not registered");
				return provider;
			}, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)),
		),
	controlRoutes: (ctx) =>
		taskControlRoutes(
			createRepoTasksScopeStores(ctx.cwd, () => {
				const provider = ctx.getProvider(REPO_TASKS_PROVIDER_TOKEN);
				if (!provider) throw new Error("repo-tasks provider is not registered");
				return provider;
			}, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)),
		),

	localClient: (ctx) => {
		const scopeStores = createRepoTasksScopeStores(
			ctx.cwd,
			createLocalDefaultProviderResolver(
				ctx.cwd,
				() => ctx.getProvider(REPO_TASKS_PROVIDER_TOKEN),
			),
			() => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE),
		);
		const handler: RepoTasksClient = {
			async list(states, scopeSelector) {
				const resolved = resolveRepoTasksScope(scopeStores, scopeSelector?.scopeId);
				return listRepoTasks(resolved.scopeRoot, states);
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
			async search(query, filter) {
				const resolved = resolveRepoTasksScope(scopeStores, filter?.scopeId);
				return searchRepoTasks(
					resolved.store,
					new RepoTasksDefaultStore(resolved.scopeRoot),
					query,
					filter,
				);
			},
			async reindex(scopeSelector) {
				const resolved = resolveRepoTasksScope(scopeStores, scopeSelector?.scopeId);
				return reindexRepoTasks(resolved.store);
			},
		};
		return { tasks: handler };
	},
	daemonClient: (link) => ({ tasks: buildRepoTasksDaemonHandler(link) }),
};

export default repoTasksModule;
