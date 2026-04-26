/**
 * Conversation recall tool — lets the agent search and read past conversations.
 *
 * Provides search, list, and read access to the conversation history store.
 * Enables the agent to remember prior interactions and reference past context.
 */

import type { KotaMessage, KotaTool } from "#core/agent-harness/message-protocol.js";
import { getHistoryProvider } from "#core/modules/provider-registry.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type { ConversationRecord } from "./history.js";

export const conversationRecallTool: KotaTool = {
	name: "conversation_recall",
	description:
		"Search and read past conversations. " +
		"Use to recall prior discussions, find what was decided, or reference previous work. " +
		"Actions: search (keyword search), list (recent conversations), read (load messages from a specific conversation).",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["search", "list", "read"],
				description: "Action to perform",
			},
			query: {
				type: "string",
				description:
					"Search terms to find relevant conversations (for 'search' action)",
			},
			id: {
				type: "string",
				description:
					"Conversation ID or prefix (for 'read' action)",
			},
			limit: {
				type: "number",
				description:
					"Max results to return (default: 10, max: 30)",
			},
		},
		required: ["action"],
	},
};

const MAX_READ_MESSAGES = 50;
const MAX_MESSAGE_TEXT_LENGTH = 500;

function formatRecord(r: ConversationRecord): string {
	const date = r.updatedAt.slice(0, 10);
	const src = r.source === "action" ? " [auto]" : "";
	return `[${r.id}] ${date} (${r.messageCount} msgs${src}) ${r.title}`;
}

/** Extract displayable text from a message's content. */
function extractMessageText(content: KotaMessage["content"]): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block.type === "text") {
			parts.push(block.text);
		} else if (block.type === "tool_use") {
			parts.push(`[tool: ${block.name}]`);
		} else if (block.type === "tool_result") {
			parts.push("[tool result]");
		}
	}
	return parts.join(" ");
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 3)}...`;
}

export async function runConversationRecall(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const action = input.action as string;
	const history = getHistoryProvider();
	const limit = Math.min(Math.max((input.limit as number) || 10, 1), 30);

	switch (action) {
		case "search": {
			const query = input.query as string;
			if (!query) {
				return {
					content: "Error: query is required for 'search'",
					is_error: true,
				};
			}
			const results = history.supportsSemanticSearch()
				? await history.semanticSearch(query, limit)
				: history.list({ search: query, limit });
			if (results.length === 0) {
				return { content: "No matching conversations found." };
			}
			return {
				content: `${results.length} conversation(s):\n${results.map(formatRecord).join("\n")}`,
			};
		}

		case "list": {
			const results = history.list({ limit });
			if (results.length === 0) {
				return { content: "No conversations in history." };
			}
			return {
				content: `${results.length} recent conversation(s):\n${results.map(formatRecord).join("\n")}`,
			};
		}

		case "read": {
			const idOrPrefix = input.id as string;
			if (!idOrPrefix) {
				return {
					content: "Error: id is required for 'read'",
					is_error: true,
				};
			}

			let record: ConversationRecord | null;
			try {
				record = history.findByPrefix(idOrPrefix);
			} catch (e) {
				return {
					content: `Error: ${(e as Error).message}`,
					is_error: true,
				};
			}
			if (!record) {
				return {
					content: `Conversation '${idOrPrefix}' not found`,
					is_error: true,
				};
			}

			const data = history.load(record.id);
			if (!data) {
				return {
					content: `Could not load conversation ${record.id}`,
					is_error: true,
				};
			}

			// Format header
			const header = [
				`Conversation: ${record.title}`,
				`ID: ${record.id}`,
				`Created: ${record.createdAt}`,
				`Messages: ${record.messageCount}`,
				"---",
			].join("\n");

			// Format messages (user + assistant only, truncated)
			const displayed = data.messages
				.filter(
					(m) =>
						m.role === "user" || m.role === "assistant",
				)
				.slice(-MAX_READ_MESSAGES);

			const lines = displayed.map((m) => {
				const role = m.role === "user" ? "User" : "Assistant";
				const text = truncate(
					extractMessageText(m.content),
					MAX_MESSAGE_TEXT_LENGTH,
				);
				return `**${role}**: ${text}`;
			});

			const trimNote =
				data.messages.length > MAX_READ_MESSAGES
					? `\n(showing last ${MAX_READ_MESSAGES} of ${data.messages.length} messages)`
					: "";

			return {
				content: `${header}\n${lines.join("\n\n")}${trimNote}`,
			};
		}

		default:
			return {
				content: `Error: unknown action '${action}'. Use search/list/read.`,
				is_error: true,
			};
	}
}
