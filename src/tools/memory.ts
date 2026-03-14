import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";
import { getMemoryStore } from "../memory.js";

export const memoryTool: Anthropic.Tool = {
  name: "memory",
  description:
    "Persistent memory across sessions (save/search/list/delete). " +
    "Store user preferences, project conventions, key decisions, and learned facts.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["save", "search", "list", "delete"],
        description: "Action to perform",
      },
      content: {
        type: "string",
        description: "Memory content to save (for 'save' action)",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags for categorization (for 'save' action, e.g. ['preference', 'testing'])",
      },
      query: {
        type: "string",
        description: "Search terms to find relevant memories (for 'search' action)",
      },
      id: {
        type: "string",
        description: "Memory ID to delete (for 'delete' action)",
      },
    },
    required: ["action"],
  },
};

export async function runMemory(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const action = input.action as string;
  const store = getMemoryStore();

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
      const results = store.search(query);
      if (results.length === 0) return { content: "No matching memories found." };
      return {
        content: results
          .slice(0, 20)
          .map((m) => `[${m.id}] (${m.tags.join(", ") || "untagged"}) ${m.content}`)
          .join("\n"),
      };
    }
    case "list": {
      const all = store.list();
      if (all.length === 0) return { content: "No memories stored." };
      return {
        content: `${all.length} memories:\n` +
          all
            .map((m) => `[${m.id}] (${m.tags.join(", ") || "untagged"}) ${m.content.slice(0, 80)}`)
            .join("\n"),
      };
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
