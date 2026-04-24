/**
 * History module — conversation recall across sessions.
 *
 * Owns the file-based ConversationHistory store and registers it as the
 * `default` history provider. Contributes the `conversation_recall` tool
 * in the `management` group and the `/api/history` HTTP routes.
 */

import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
	conversationRecallTool,
	runConversationRecall,
} from "./conversation-recall.js";
import { getHistory } from "./history.js";
import { historyRoutes } from "./routes.js";

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
};

export default historyModule;
