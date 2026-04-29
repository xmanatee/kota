/**
 * History module — conversation recall across sessions.
 *
 * Owns the file-based ConversationHistory store and registers it as the
 * `default` history provider. Contributes the `conversation_recall` tool
 * in the `management` group and the `/api/history` HTTP routes.
 */

import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { getHistoryProvider } from "#core/modules/provider-registry.js";
import type { HistoryClient } from "#core/server/kota-client.js";
import { createHistoryReadinessSource } from "./capability-readiness.js";
import {
	conversationRecallTool,
	runConversationRecall,
} from "./conversation-recall.js";
import { getHistory } from "./history.js";
import { historyControlRoutes, historyRoutes } from "./routes.js";

const historyModule: KotaModule = {
	name: "history",
	version: "1.0.0",
	description:
		"Conversation recall — search and read past conversations",
	dependencies: ["rendering"],
	tools: [
		{
			tool: conversationRecallTool,
			runner: runConversationRecall,
			risk: "safe",
			kind: "discovery",
			group: "management",
		},
	],
	skills: [{ name: "history", promptPath: "src/modules/history/history.md" }],

	onLoad: (ctx: ModuleContext) => {
		const store = getHistory();
		ctx.registerProvider("history", store);
		ctx.registerProvider(
			CAPABILITY_READINESS_PROVIDER_TYPE,
			createHistoryReadinessSource(store),
		);
	},

	routes: () => historyRoutes(),
	controlRoutes: () => historyControlRoutes(),

	localClient: () => {
		const handler: HistoryClient = {
			async list(filter) {
				return { conversations: getHistoryProvider().list(filter) };
			},
			async show(id) {
				const data = getHistoryProvider().load(id);
				return data ? { found: true, data } : { found: false };
			},
			async delete(id) {
				return getHistoryProvider().remove(id)
					? { ok: true }
					: { ok: false, reason: "not_found" };
			},
			async search(query, filter) {
				const provider = getHistoryProvider();
				const limit = filter?.limit ?? 20;
				if (filter?.semantic) {
					if (!provider.supportsSemanticSearch()) {
						return { ok: false, reason: "semantic_unavailable" };
					}
					const conversations = await provider.semanticSearch(query, limit, {
						cwd: filter.cwd,
						source: filter.source,
					});
					return { ok: true, conversations };
				}
				const conversations = provider.list({
					search: query,
					limit,
					cwd: filter?.cwd,
					source: filter?.source,
				});
				return { ok: true, conversations };
			},
			async reindex() {
				return getHistoryProvider().reindex();
			},
		};
		return { history: handler };
	},
};

export default historyModule;
