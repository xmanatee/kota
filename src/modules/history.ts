/**
 * History module — conversation recall across sessions.
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
	promptSection: () =>
		"Search and read past conversations to recall prior discussions, decisions, and context. " +
		"When the user references something from a previous session, use conversation_recall to find it. " +
		"Prefer memory/knowledge for facts; use conversation_recall for full conversational context.",
};

export default historyModule;
