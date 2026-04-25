/**
 * History module — conversation recall across sessions.
 *
 * Owns the file-based ConversationHistory store and registers it as the
 * `default` history provider. Contributes the `conversation_recall` tool
 * in the `management` group and the `/api/history` HTTP routes.
 */

import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { HistoryClient } from "#core/server/kota-client.js";
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
		ctx.registerProvider("history", getHistory());
	},

	routes: () => historyRoutes(),
	controlRoutes: () => historyControlRoutes(),

	localClient: () => {
		const handler: HistoryClient = {
			async list(filter) {
				return { conversations: getHistory().list(filter) };
			},
			async show(id) {
				const data = getHistory().load(id);
				return data ? { found: true, data } : { found: false };
			},
			async delete(id) {
				return getHistory().remove(id) ? { ok: true } : { ok: false, reason: "not_found" };
			},
		};
		return { history: handler };
	},
};

export default historyModule;
