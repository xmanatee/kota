import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { createRepoTasksDaemonClient } from "#root/client/kota-client.generated.js";
import type {
	RepoTaskCaptureResult,
	RepoTaskCreateOptions,
	RepoTaskCreateResult,
	RepoTaskMoveResult,
	RepoTaskShowResult,
	RepoTaskState,
	RepoTasksClient,
	RepoTaskUpdateBodyResult,
} from "./client.js";
import {
	readRepoTaskRouteError,
	scopeQuery,
	throwRepoTaskRouteError,
} from "./daemon-client-errors.js";

export function buildRepoTasksDaemonHandler(link: DaemonTransport): RepoTasksClient {
	return createRepoTasksDaemonClient(link, {
		show: async (id, scopeSelector): Promise<RepoTaskShowResult> => {
			const query = scopeQuery(scopeSelector?.scopeId);
			const res = await link.fetchRaw(
				`/api/tasks/${encodeURIComponent(id)}${query}`,
				{ method: "GET" },
			);
			if (res.status === 404) {
				const errBody = await readRepoTaskRouteError(res);
				if (errBody?.reason === "unknown_scope" && errBody.scopeId) {
					throw new Error(`Unknown scope: ${errBody.scopeId}`);
				}
				return { found: false };
			}
			if (!res.ok) {
				await throwRepoTaskRouteError(res, `HTTP ${res.status}`);
			}
			const okBody = (await res.json()) as { state: RepoTaskState; content: string };
			return { found: true, state: okBody.state, content: okBody.content };
		},
		move: async (id, toState, scopeSelector): Promise<RepoTaskMoveResult> => {
			const query = scopeQuery(scopeSelector?.scopeId);
			const res = await link.fetchRaw(
				`/api/tasks/${encodeURIComponent(id)}/move${query}`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ state: toState }),
				},
			);
			if (res.status === 404) {
				const errBody = await readRepoTaskRouteError(res);
				if (errBody?.reason === "unknown_scope" && errBody.scopeId) {
					throw new Error(`Unknown scope: ${errBody.scopeId}`);
				}
				return { ok: false, reason: "not_found" };
			}
			if (res.status === 400) {
				const errBody = await readRepoTaskRouteError(res);
				if (errBody?.reason === "invalid_id") {
					return { ok: false, reason: "invalid_id" };
				}
				throw new Error(errBody?.error ?? "HTTP 400");
			}
			if (res.status === 409) {
				const conflictBody = (await res.json().catch(() => ({}))) as {
					reason?: string;
					state?: RepoTaskState;
				};
				return {
					ok: false,
					reason: "already_in_state",
					state: conflictBody.state ?? toState,
				};
			}
			if (!res.ok) {
				await throwRepoTaskRouteError(res, `HTTP ${res.status}`);
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
		updateBody: async (id, body, scopeSelector): Promise<RepoTaskUpdateBodyResult> => {
			const query = scopeQuery(scopeSelector?.scopeId);
			const res = await link.fetchRaw(
				`/api/tasks/${encodeURIComponent(id)}/body${query}`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ body }),
				},
			);
			if (res.status === 404) return { ok: false, reason: "not_found" };
			if (res.status === 409) {
				return { ok: false, reason: "terminal" };
			}
			if (!res.ok) {
				const error = await readRepoTaskRouteError(res);
				if (error?.error === "Could not parse task file") {
					return { ok: false, reason: "malformed" };
				}
				await throwRepoTaskRouteError(res, `HTTP ${res.status}`);
			}
			const found = await link.fetchRaw(
				`/api/tasks/${encodeURIComponent(id)}${query}`,
				{ method: "GET" },
			);
			if (!found.ok) return { ok: false, reason: "not_found" };
			const result = (await found.json()) as { state: RepoTaskState; content: string };
			return { ok: true, id, state: result.state, content: result.content };
		},
		create: async (options: RepoTaskCreateOptions): Promise<RepoTaskCreateResult> => {
			const { scopeId, ...body } = options;
			const query = scopeQuery(scopeId);
			const res = await link.fetchRaw(`/api/tasks/normalized${query}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
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
				await throwRepoTaskRouteError(res, `HTTP ${res.status}`);
			}
			const okBody = (await res.json()) as { id: string; path: string };
			return { ok: true, id: okBody.id, path: okBody.path };
		},
		capture: async (title: string, scopeSelector): Promise<RepoTaskCaptureResult> => {
			const query = scopeQuery(scopeSelector?.scopeId);
			const res = await link.fetchRaw(`/api/tasks/capture${query}`, {
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
				await throwRepoTaskRouteError(res, `HTTP ${res.status}`);
			}
			const okBody = (await res.json()) as { id: string; path: string };
			return { ok: true, id: okBody.id, path: okBody.path };
		},
	});
}
