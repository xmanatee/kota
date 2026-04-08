import type Anthropic from "@anthropic-ai/sdk";
import { getMemoryProvider } from "../../providers.js";
import type { ToolResult } from "../../tools/tool-result.js";

export const memoryTool: Anthropic.Tool = {
  name: "memory",
  description:
    "Persistent memory across sessions (save/search/list/update/delete). " +
    "Store user preferences, project conventions, key decisions, and learned facts. " +
    "Supports tags for categorization and time-based filtering.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["save", "search", "list", "update", "delete"],
        description: "Action to perform",
      },
      content: {
        type: "string",
        description: "Memory content (for 'save' and 'update' actions)",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags for categorization (for 'save'/'update', e.g. ['preference', 'project'])",
      },
      query: {
        type: "string",
        description: "Search terms to find relevant memories (for 'search' action)",
      },
      tag: {
        type: "string",
        description: "Filter results to only memories with this tag (for 'search' action)",
      },
      since: {
        type: "string",
        description: "ISO date — only return memories created after this date (for 'search', e.g. '2025-03-01')",
      },
      id: {
        type: "string",
        description: "Memory ID (for 'update' and 'delete' actions)",
      },
    },
    required: ["action"],
  },
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export async function runMemory(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const action = input.action as string;
  const store = getMemoryProvider();

  switch (action) {
    case "save": {
      const content = input.content as string;
      if (!content) return { content: "Error: content is required for 'save'", is_error: true };
      const tags = (input.tags as string[]) || [];
      const id = store.save(content, tags);
      return { content: `Saved memory ${id}: ${content.slice(0, 100)}` };
    }
    case "search": {
      const query = input.query as string;
      if (!query) return { content: "Error: query is required for 'search'", is_error: true };
      const tag = input.tag as string | undefined;
      const since = input.since as string | undefined;
      const results = store.search(query, { tag, since });
      if (results.length === 0) return { content: "No matching memories found." };
      return {
        content: results
          .slice(0, 20)
          .map((m) => `[${m.id}] ${formatTimestamp(m.created)} (${m.tags.join(", ") || "untagged"}) ${m.content}`)
          .join("\n"),
      };
    }
    case "list": {
      const all = store.list();
      if (all.length === 0) return { content: "No memories stored." };
      return {
        content: `${all.length} memories:\n` +
          all
            .map((m) => `[${m.id}] ${formatTimestamp(m.created)} (${m.tags.join(", ") || "untagged"}) ${m.content.slice(0, 80)}`)
            .join("\n"),
      };
    }
    case "update": {
      const id = input.id as string;
      if (!id) return { content: "Error: id is required for 'update'", is_error: true };
      const content = input.content as string | undefined;
      const tags = input.tags as string[] | undefined;
      if (content === undefined && tags === undefined) {
        return { content: "Error: provide content and/or tags to update", is_error: true };
      }
      const updated = store.update(id, { content, tags });
      return updated
        ? { content: `Updated memory ${id}` }
        : { content: `Memory ${id} not found`, is_error: true };
    }
    case "delete": {
      const id = input.id as string;
      if (!id) return { content: "Error: id is required for 'delete'", is_error: true };
      const deleted = store.delete(id);
      return deleted
        ? { content: `Deleted memory ${id}` }
        : { content: `Memory ${id} not found`, is_error: true };
    }
    default:
      return { content: `Error: unknown action '${action}'`, is_error: true };
  }
}
