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
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { createRepoTasksReadinessSource } from "./capability-readiness.js";
import { listTasksForStates, registerTaskCommands } from "./cli.js";
import type {
	RepoTaskCaptureResult,
	RepoTaskCreateOptions,
	RepoTaskCreateResult,
	RepoTaskGcOptions,
	RepoTaskGcResult,
	RepoTaskListEntry,
	RepoTaskMoveResult,
	RepoTaskReindexResult,
	RepoTaskSearchFilter,
	RepoTaskSearchResult,
	RepoTaskShowResult,
	RepoTaskState,
	RepoTasksClient,
} from "./client.js";
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
	daemonClient: (link) => ({ tasks: buildRepoTasksDaemonHandler(link) }),
};

/**
 * Daemon-side `RepoTasksClient` backed by the typed `DaemonTransport`. Calls
 * the `/api/tasks*` and `/tasks/*` HTTP routes the daemon owns.
 *
 *  - `list(states)` GETs `/api/tasks` through `link.fetchRaw`. On transport
 *    failure or non-ok response it returns `{ tasks: [] }` (the soft-fail
 *    contract preserved from the prior inline closure). On success it parses
 *    the `{ counts, tasks: Record<state, [...] >}` body, flattens entries
 *    matching the caller's requested states (defaulting to the four open
 *    states when omitted), and skips terminal `done`/`dropped` states.
 *  - `show(id)` GETs `/api/tasks/<id>`. 404 returns `{ found: false }`;
 *    other non-ok throws the daemon's `error` field; success returns
 *    `{ found: true, state, content }`.
 *  - `move(id, toState)` PATCHes `/api/tasks/<id>/move` with body
 *    `{ state: toState }`. 404 collapses to `not_found`; 409 to
 *    `already_in_state` (with the response body's `state` or `toState`);
 *    other non-ok throws; success returns the move shape.
 *  - `create(options)` POSTs `/api/tasks/normalized` with the full
 *    `RepoTaskCreateOptions` body. 409 → `already_exists`; 400 →
 *    `invalid_slug`; other non-ok throws; success returns `{ ok: true,
 *    id, path }`.
 *  - `capture(title)` POSTs `/api/tasks/capture` with body `{ title }`.
 *    Same conflict and success arms as `create`.
 *  - `gc(options)` POSTs `/api/tasks/gc` with `options ?? {}`. Non-ok
 *    throws; success returns the parsed `RepoTaskGcResult` body verbatim.
 *  - `search(query, filter)` GETs `/tasks/search?q=…` with `semantic`,
 *    `limit`, and `state` query params. Non-ok throws; success returns
 *    the parsed `RepoTaskSearchResult` body verbatim.
 *  - `reindex()` POSTs `/tasks/reindex`. Non-ok throws; success returns
 *    the parsed `RepoTaskReindexResult` body verbatim.
 */
function buildRepoTasksDaemonHandler(link: DaemonTransport): RepoTasksClient {
	return {
		list: async (states) => {
			const wanted = states && states.length > 0 ? states : REPO_TASK_OPEN_STATES;
			type ListBody = {
				counts: Record<string, number>;
				tasks: Record<
					string,
					{
						id: string;
						title: string;
						priority: string;
						area: string;
						summary: string;
						body: string;
					}[]
				>;
			};
			let body: ListBody | null = null;
			try {
				const res = await link.fetchRaw("/api/tasks", { method: "GET" });
				if (res.ok) {
					body = (await res.json()) as ListBody;
				}
			} catch {
				body = null;
			}
			const tasks: RepoTaskListEntry[] = [];
			if (body) {
				for (const state of wanted) {
					if (state === "done" || state === "dropped") continue;
					const stateTasks = body.tasks[state] ?? [];
					for (const task of stateTasks) {
						tasks.push({
							id: task.id,
							priority: task.priority,
							title: task.title,
							state,
						});
					}
				}
			}
			return { tasks };
		},
		show: async (id): Promise<RepoTaskShowResult> => {
			const res = await link.fetchRaw(
				`/api/tasks/${encodeURIComponent(id)}`,
				{ method: "GET" },
			);
			if (res.status === 404) return { found: false };
			if (!res.ok) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errBody.error ?? `HTTP ${res.status}`);
			}
			const okBody = (await res.json()) as { state: RepoTaskState; content: string };
			return { found: true, state: okBody.state, content: okBody.content };
		},
		move: async (id, toState): Promise<RepoTaskMoveResult> => {
			const res = await link.fetchRaw(
				`/api/tasks/${encodeURIComponent(id)}/move`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ state: toState }),
				},
			);
			if (res.status === 404) return { ok: false, reason: "not_found" };
			if (res.status === 409) {
				const conflictBody = (await res.json().catch(() => ({}))) as {
					state?: RepoTaskState;
				};
				return {
					ok: false,
					reason: "already_in_state",
					state: conflictBody.state ?? toState,
				};
			}
			if (!res.ok) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errBody.error ?? `HTTP ${res.status}`);
			}
			const okBody = (await res.json()) as {
				id: string;
				fromState: RepoTaskState;
				toState: RepoTaskState;
				path: string;
				previousPath: string;
			};
			return {
				ok: true,
				id: okBody.id,
				fromState: okBody.fromState,
				toState: okBody.toState,
				path: okBody.path,
				previousPath: okBody.previousPath,
			};
		},
		create: async (options: RepoTaskCreateOptions): Promise<RepoTaskCreateResult> => {
			const res = await link.fetchRaw("/api/tasks/normalized", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(options),
			});
			if (res.status === 409) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				return { ok: false, reason: "already_exists", message: errBody.error };
			}
			if (res.status === 400) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				return { ok: false, reason: "invalid_slug", message: errBody.error };
			}
			if (!res.ok) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errBody.error ?? `HTTP ${res.status}`);
			}
			const okBody = (await res.json()) as { id: string; path: string };
			return { ok: true, id: okBody.id, path: okBody.path };
		},
		capture: async (title: string): Promise<RepoTaskCaptureResult> => {
			const res = await link.fetchRaw("/api/tasks/capture", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title }),
			});
			if (res.status === 409) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				return { ok: false, reason: "already_exists", message: errBody.error };
			}
			if (res.status === 400) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				return { ok: false, reason: "invalid_slug", message: errBody.error };
			}
			if (!res.ok) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errBody.error ?? `HTTP ${res.status}`);
			}
			const okBody = (await res.json()) as { id: string; path: string };
			return { ok: true, id: okBody.id, path: okBody.path };
		},
		gc: async (options?: RepoTaskGcOptions): Promise<RepoTaskGcResult> => {
			const res = await link.fetchRaw("/api/tasks/gc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(options ?? {}),
			});
			if (!res.ok) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errBody.error ?? `HTTP ${res.status}`);
			}
			return (await res.json()) as RepoTaskGcResult;
		},
		search: async (
			query: string,
			filter?: RepoTaskSearchFilter,
		): Promise<RepoTaskSearchResult> => {
			const params = new URLSearchParams();
			params.set("q", query);
			if (filter?.semantic === false) params.set("semantic", "false");
			if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
			if (filter?.states) {
				for (const state of filter.states) params.append("state", state);
			}
			const res = await link.fetchRaw(`/tasks/search?${params.toString()}`);
			if (!res.ok) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errBody.error ?? `HTTP ${res.status}`);
			}
			return (await res.json()) as RepoTaskSearchResult;
		},
		reindex: async (): Promise<RepoTaskReindexResult> => {
			const res = await link.fetchRaw("/tasks/reindex", { method: "POST" });
			if (!res.ok) {
				const errBody = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errBody.error ?? `HTTP ${res.status}`);
			}
			return (await res.json()) as RepoTaskReindexResult;
		},
	};
}

export default repoTasksModule;
