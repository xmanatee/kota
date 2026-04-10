/**
 * History module — conversation recall across sessions.
 *
 * Registers the `conversation_recall` tool in the `management` group.
 * Enables the agent to search and read past conversations.
 */

import type { KotaModule } from "../../module-types.js";
import {
	conversationRecallTool,
	runConversationRecall,
} from "./conversation-recall.js";
import { historyRoutes } from "./routes.js";

const historyModule: KotaModule = {
	name: "history",
	version: "1.0.0",
	description:
		"Conversation recall — search and read past conversations",
	tools: [
		{
			tool: conversationRecallTool,
			runner: runConversationRecall,
			risk: "safe",
			kind: "discovery",
			group: "management",
		},
	],
	skills: [{ name: "history", promptPath: "src/modules/skills/history.md" }],

	routes: () => historyRoutes(),
};

export default historyModule;
