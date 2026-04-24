/**
 * Workspace tool — shared blackboard for multi-agent coordination.
 *
 * Parent agent creates a workspace, delegates tasks that read/write to it.
 * Sub-agents share findings without routing through the parent.
 */

import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/index.js";
import {
  clearAllWorkspaces,
  createWorkspace,
  deleteEntry,
  deleteWorkspace,
  listWorkspaces,
  readAllEntries,
  readEntry,
  writeEntry,
} from "./workspace-store.js";

export const workspaceTool: KotaTool = {
  name: "workspace",
  description:
    "Shared workspace (blackboard) for multi-agent coordination. " +
    "Create a workspace, write entries from any agent, read shared findings. " +
    "Use with delegate/batch/map so sub-agents can share results directly.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "write", "read", "list", "delete"],
        description:
          "create: create/get a named workspace. " +
          "write: set a key-value entry. " +
          "read: get one entry by key, or all entries if no key. " +
          "list: list all workspaces. " +
          "delete: remove a workspace or a single entry.",
      },
      workspace: {
        type: "string",
        description: "Workspace name (required for create/write/read/delete).",
      },
      key: {
        type: "string",
        description: "Entry key (for write, read one, delete entry).",
      },
      value: {
        type: "string",
        description: "Entry value — any text: JSON, markdown, plain (for write).",
      },
      author: {
        type: "string",
        description: "Optional author identifier (for write).",
      },
    },
    required: ["action"],
  },
};

function formatEntry(e: { key: string; value: string; author?: string; updatedAt: number }): string {
  const ts = new Date(e.updatedAt).toISOString().slice(0, 19);
  const by = e.author ? ` (by ${e.author})` : "";
  return `[${e.key}]${by} ${ts}\n${e.value}`;
}

export async function runWorkspace(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const action = input.action as string;
  const name = input.workspace as string | undefined;

  switch (action) {
    case "create": {
      if (!name) return { content: "Error: workspace name is required", is_error: true };
      const ws = createWorkspace(name);
      return { content: `Workspace "${ws.name}" ready (${ws.entries.size} entries).` };
    }

    case "write": {
      if (!name) return { content: "Error: workspace name is required", is_error: true };
      const key = input.key as string;
      if (!key) return { content: "Error: key is required for write", is_error: true };
      const value = input.value as string;
      if (value === undefined || value === null) {
        return { content: "Error: value is required for write", is_error: true };
      }
      const author = input.author as string | undefined;
      writeEntry(name, key, value, author);
      return { content: `Written "${key}" to workspace "${name}".` };
    }

    case "read": {
      if (!name) return { content: "Error: workspace name is required", is_error: true };
      const key = input.key as string | undefined;
      if (key) {
        const entry = readEntry(name, key);
        if (!entry) return { content: `Entry "${key}" not found in workspace "${name}".`, is_error: true };
        return { content: formatEntry(entry) };
      }
      const entries = readAllEntries(name);
      if (entries.length === 0) return { content: `Workspace "${name}" is empty.` };
      return { content: `${entries.length} entries in "${name}":\n\n${entries.map(formatEntry).join("\n\n")}` };
    }

    case "list": {
      const all = listWorkspaces();
      if (all.length === 0) return { content: "No workspaces." };
      const lines = all.map(
        (ws) => `- ${ws.name}: ${ws.entryCount} entries (created ${new Date(ws.createdAt).toISOString().slice(0, 19)})`,
      );
      return { content: `${all.length} workspace(s):\n${lines.join("\n")}` };
    }

    case "delete": {
      if (!name) return { content: "Error: workspace name is required", is_error: true };
      const key = input.key as string | undefined;
      if (key) {
        const ok = deleteEntry(name, key);
        return ok
          ? { content: `Deleted entry "${key}" from workspace "${name}".` }
          : { content: `Entry "${key}" not found in workspace "${name}".`, is_error: true };
      }
      const ok = deleteWorkspace(name);
      return ok
        ? { content: `Deleted workspace "${name}".` }
        : { content: `Workspace "${name}" not found.`, is_error: true };
    }

    default:
      return { content: `Unknown action "${action}". Use create/write/read/list/delete.`, is_error: true };
  }
}

export { clearAllWorkspaces };
