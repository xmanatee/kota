/**
 * History extension — conversation recall across sessions.
 *
 * Registers the `conversation_recall` tool in the `management` group.
 * Enables the agent to search and read past conversations.
 */

import type { KotaExtension } from "../extension-types.js";
import {
	conversationRecallTool,
	runConversationRecall,
} from "../tools/conversation-recall.js";

const historyModule: KotaExtension = {
	name: "history",
	version: "1.0.0",
	description:
		"Conversation recall — search and read past conversations",
	tools: [
		{
			tool: conversationRecallTool,
			runner: runConversationRecall,
			group: "management",
		},
	],
	skills: [{ name: "history", promptPath: "src/extensions/skills/history.md" }],
};

export default historyModule;
