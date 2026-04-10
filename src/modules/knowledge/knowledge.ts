/**
 * Knowledge tool — agent-facing interface to the file-based data layer.
 *
 * Provides CRUD + search over markdown files with YAML front matter.
 * Entries live in .kota/data/ (project) or ~/.kota/data/ (global).
 */

import { tryEmit } from "#core/events/event-bus.js";
import { getKnowledgeProvider } from "#core/modules/provider-registry.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { knowledgeTool } from "./knowledge-schema.js";

export { knowledgeTool };

function formatEntry(e: {
	id: string;
	title: string;
	type: string;
	tags: string[];
	status: string;
	updated: string;
	content: string;
}): string {
	const date = e.updated.slice(0, 10);
	const tags = e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : "";
	return `[${e.id}] ${date} (${e.type}/${e.status})${tags} ${e.title}`;
}

function formatEntryFull(e: {
	id: string;
	title: string;
	type: string;
	tags: string[];
	status: string;
	created: string;
	updated: string;
	content: string;
	meta: Record<string, string>;
}): string {
	const parts = [
		`ID: ${e.id}`,
		`Title: ${e.title}`,
		`Type: ${e.type}`,
		`Status: ${e.status}`,
		`Tags: ${e.tags.join(", ") || "(none)"}`,
		`Created: ${e.created}`,
		`Updated: ${e.updated}`,
	];
	const metaKeys = Object.keys(e.meta);
	if (metaKeys.length > 0) {
		for (const k of metaKeys) {
			parts.push(`${k}: ${e.meta[k]}`);
		}
	}
	parts.push("", e.content);
	return parts.join("\n");
}

export async function runKnowledge(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const action = input.action as string;
	const store = getKnowledgeProvider();

	switch (action) {
		case "create": {
			const title = input.title as string;
			if (!title) {
				return {
					content: "Error: title is required for create",
					is_error: true,
				};
			}
			const content = (input.content as string) || "";
			const entryType = (input.type as string) || "note";
			const entryTags = (input.tags as string[]) || [];
			const entryScope = (input.scope as "project" | "global") || "project";
			const id = store.create({
				title,
				content,
				type: entryType,
				tags: entryTags,
				status: (input.status as string) || "active",
				scope: entryScope,
				meta: (input.meta as Record<string, string>) || undefined,
			});
			tryEmit("knowledge.create", { id, title, type: entryType, tags: entryTags, scope: entryScope });
			return {
				content: `Created entry ${id}: "${title}" (${entryType})`,
			};
		}

		case "read": {
			const id = input.id as string;
			if (!id) {
				return {
					content: "Error: id is required for read",
					is_error: true,
				};
			}
			const entry = store.read(id);
			if (!entry) {
				return {
					content: `Entry ${id} not found`,
					is_error: true,
				};
			}
			return { content: formatEntryFull(entry) };
		}

		case "update": {
			const id = input.id as string;
			if (!id) {
				return {
					content: "Error: id is required for update",
					is_error: true,
				};
			}
			const changes: Parameters<typeof store.update>[1] = {};
			if (input.title !== undefined)
				changes.title = input.title as string;
			if (input.content !== undefined)
				changes.content = input.content as string;
			if (input.type !== undefined) changes.type = input.type as string;
			if (input.tags !== undefined)
				changes.tags = input.tags as string[];
			if (input.status !== undefined)
				changes.status = input.status as string;
			if (input.meta !== undefined)
				changes.meta = input.meta as Record<string, string>;

			if (Object.keys(changes).length === 0) {
				return {
					content:
						"Error: provide at least one field to update (title, content, type, tags, status, meta)",
					is_error: true,
				};
			}
			const ok = store.update(id, changes);
			if (ok) {
				tryEmit("knowledge.update", { id, fields: Object.keys(changes) });
				return { content: `Updated entry ${id}` };
			}
			return { content: `Entry ${id} not found`, is_error: true };
		}

		case "delete": {
			const id = input.id as string;
			if (!id) {
				return {
					content: "Error: id is required for delete",
					is_error: true,
				};
			}
			const ok = store.delete(id);
			if (ok) {
				tryEmit("knowledge.delete", { id });
				return { content: `Deleted entry ${id}` };
			}
			return { content: `Entry ${id} not found`, is_error: true };
		}

		case "search": {
			const query = input.query as string;
			if (!query) {
				return {
					content: "Error: query is required for search",
					is_error: true,
				};
			}
			const results = store.search(query, {
				type: input.type as string | undefined,
				tag: input.tag as string | undefined,
				status: input.status as string | undefined,
				since: input.since as string | undefined,
				scope: input.scope as "project" | "global" | "all" | undefined,
			});
			if (results.length === 0) {
				return { content: "No matching entries found." };
			}
			const lines = results.slice(0, 20).map(formatEntry);
			return {
				content: `${results.length} result(s):\n${lines.join("\n")}`,
			};
		}

		case "list": {
			const entries = store.list({
				type: input.type as string | undefined,
				tag: input.tag as string | undefined,
				status: input.status as string | undefined,
				since: input.since as string | undefined,
				scope: input.scope as "project" | "global" | "all" | undefined,
			});
			if (entries.length === 0) {
				return { content: "No entries found." };
			}
			const lines = entries.slice(0, 30).map(formatEntry);
			const more =
				entries.length > 30
					? `\n(+${entries.length - 30} more)`
					: "";
			return { content: `${entries.length} entry/entries:\n${lines.join("\n")}${more}` };
		}

		default:
			return {
				content: `Error: unknown action '${action}'. Use create/read/update/delete/search/list.`,
				is_error: true,
			};
	}
}
