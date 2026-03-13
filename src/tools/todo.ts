import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export type TodoItem = {
  id: number;
  task: string;
  status: "pending" | "in_progress" | "done";
};

let todos: TodoItem[] = [];
let nextId = 1;

export const todoTool: Anthropic.Tool = {
  name: "todo",
  description:
    "Track tasks for the current session. Use to break down work, " +
    "track progress, and stay organized. The current todo list is " +
    "always visible in your system context.",
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
      const item: TodoItem = { id: nextId++, task, status: "pending" };
      todos.push(item);
      return { content: `Added task #${item.id}: ${task}` };
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

function formatTodos(): string {
  if (todos.length === 0) return "No tasks.";
  return todos
    .map((t) => {
      const icon = t.status === "done" ? "✓" : t.status === "in_progress" ? "→" : "○";
      return `${icon} #${t.id} [${t.status}] ${t.task}`;
    })
    .join("\n");
}

export function getTodoState(): string {
  if (todos.length === 0) return "";
  return "\n<current-tasks>\n" + formatTodos() + "\n</current-tasks>";
}
