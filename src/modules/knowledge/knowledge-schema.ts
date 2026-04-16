import type Anthropic from "@anthropic-ai/sdk";

export const knowledgeTool: Anthropic.Tool = {
	name: "knowledge",
	description:
		"Structured knowledge base — store, search, and manage entries as markdown files with metadata. " +
		"Use for research findings, project decisions, reference material, plans, contacts, bookmarks — " +
		"anything that should persist across sessions and be human-readable. " +
		"Entries support type, tags, status, and custom metadata fields.",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["create", "read", "update", "delete", "search", "list"],
				description: "Operation to perform",
			},
			title: {
				type: "string",
				description: "Entry title (for create)",
			},
			content: {
				type: "string",
				description:
					"Markdown content body (for create/update)",
			},
			type: {
				type: "string",
				description:
					'Entry type for categorization (e.g. "note", "decision", "research", "plan", "contact", "reference"). For create/search/list.',
			},
			tags: {
				type: "array",
				items: { type: "string" },
				description:
					"Tags for categorization and filtering (for create/update/search/list)",
			},
			status: {
				type: "string",
				description:
					'Entry status (e.g. "active", "archived", "draft"). For create/update/search/list.',
			},
			id: {
				type: "string",
				description: "Entry ID (for read/update/delete)",
			},
			query: {
				type: "string",
				description: "Search terms (for search action)",
			},
			semantic: {
				type: "boolean",
				description:
					"When true, use embedding-backed semantic ranking instead of keyword matching (for search). " +
					"Falls back to keyword search if semantic search is not configured or fails.",
			},
			topK: {
				type: "integer",
				description:
					"Maximum number of results to return (for search). Default: 20.",
			},
			scope: {
				type: "string",
				enum: ["project", "global", "all"],
				description:
					"Storage scope — project (.kota/data/) or global (~/.kota/data/). Default: project.",
			},
			meta: {
				type: "object",
				description:
					"Additional metadata fields as key-value pairs (for create/update)",
			},
			since: {
				type: "string",
				description:
					"ISO date — only return entries created after this date (for search/list)",
			},
		},
		required: ["action"],
	},
};
