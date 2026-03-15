import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export type TodoItem = {
  id: number;
  task: string;
  status: "pending" | "in_progress" | "done";
  parent_id?: number;
};

let todos: TodoItem[] = [];
let nextId = 1;

export const todoTool: Anthropic.Tool = {
  name: "todo",
  description:
    "Track tasks for the current session. Use to break down work, " +
    "track progress, and stay organized. Supports subtasks via parent_id " +
    "for hierarchical task breakdown. The current todo list is always " +
    "visible in your system context.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["add", "update", "list", "clear"],
        description: "Action to perform on the todo list",
      },
      task: {
        type: "string",
        description: "Task description (for 'add' action)",
      },
      id: {
        type: "number",
        description: "Task ID (for 'update' action)",
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "done"],
        description: "New status (for 'update' action)",
      },
      parent_id: {
        type: "number",
        description: "Parent task ID to create a subtask (for 'add' action)",
      },
    },
    required: ["action"],
  },
};

export async function runTodo(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const action = input.action as string;

  switch (action) {
    case "add": {
      const task = input.task as string;
      if (!task) return { content: "Error: task is required for 'add'", is_error: true };
      const parent_id = input.parent_id as number | undefined;
      if (parent_id !== undefined && !todos.find((t) => t.id === parent_id)) {
        return { content: `Error: parent task #${parent_id} not found`, is_error: true };
      }
      const item: TodoItem = { id: nextId++, task, status: "pending" };
      if (parent_id !== undefined) item.parent_id = parent_id;
      todos.push(item);
      const suffix = parent_id !== undefined ? ` (subtask of #${parent_id})` : "";
      return { content: `Added task #${item.id}: ${task}${suffix}` };
    }
    case "update": {
      const id = input.id as number;
      const status = input.status as TodoItem["status"];
      if (!id) return { content: "Error: id is required for 'update'", is_error: true };
      if (!status) return { content: "Error: status is required for 'update'", is_error: true };
      const item = todos.find((t) => t.id === id);
      if (!item) return { content: `Error: task #${id} not found`, is_error: true };
      item.status = status;
      return { content: `Updated task #${id} to ${status}` };
    }
    case "list": {
      return { content: formatTodos() };
    }
    case "clear": {
      todos = [];
      nextId = 1;
      return { content: "Cleared all tasks" };
    }
    default:
      return { content: `Error: unknown action '${action}'`, is_error: true };
  }
}

function formatItem(t: TodoItem, depth: number): string {
  const icon = t.status === "done" ? "✓" : t.status === "in_progress" ? "→" : "○";
  const indent = "  ".repeat(depth);
  return `${indent}${icon} #${t.id} [${t.status}] ${t.task}`;
}

function formatTodos(): string {
  if (todos.length === 0) return "No tasks.";
  const lines: string[] = [];

  function renderTree(parentId: number | undefined, depth: number) {
    const items = todos.filter((t) =>
      parentId === undefined ? t.parent_id === undefined : t.parent_id === parentId,
    );
    for (const item of items) {
      lines.push(formatItem(item, depth));
      renderTree(item.id, depth + 1);
    }
  }

  renderTree(undefined, 0);
  return lines.join("\n");
}

export function getTodoState(): string {
  if (todos.length === 0) return "";
  return "\n<current-tasks>\n" + formatTodos() + "\n</current-tasks>";
}
