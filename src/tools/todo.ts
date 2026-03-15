import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export type Priority = "high" | "medium" | "low";

export type TodoItem = {
  id: number;
  task: string;
  status: "pending" | "in_progress" | "done";
  parent_id?: number;
  priority?: Priority;
  blocked_by?: number[];
};

let todos: TodoItem[] = [];
let nextId = 1;

export const todoTool: Anthropic.Tool = {
  name: "todo",
  description:
    "Track tasks for the current session. Use to break down work, " +
    "track progress, and stay organized. Supports subtasks via parent_id, " +
    "priorities (high/medium/low), and dependency tracking via blocked_by. " +
    "The current todo list is always visible in your system context.",
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
      priority: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Task priority (for 'add' or 'update' action)",
      },
      blocked_by: {
        type: "array",
        items: { type: "number" },
        description:
          "IDs of tasks that must complete before this one can start (for 'add' or 'update')",
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
      const blocked_by = input.blocked_by as number[] | undefined;
      if (blocked_by) {
        for (const depId of blocked_by) {
          if (!todos.find((t) => t.id === depId))
            return { content: `Error: dependency task #${depId} not found`, is_error: true };
        }
      }
      const item: TodoItem = { id: nextId++, task, status: "pending" };
      if (parent_id !== undefined) item.parent_id = parent_id;
      if (input.priority) item.priority = input.priority as Priority;
      if (blocked_by && blocked_by.length > 0) item.blocked_by = blocked_by;
      todos.push(item);
      const parts: string[] = [];
      if (parent_id !== undefined) parts.push(`subtask of #${parent_id}`);
      if (item.priority) parts.push(`priority: ${item.priority}`);
      if (item.blocked_by) parts.push(`blocked by: #${item.blocked_by.join(", #")}`);
      const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return { content: `Added task #${item.id}: ${task}${suffix}` };
    }
    case "update": {
      const id = input.id as number;
      if (!id) return { content: "Error: id is required for 'update'", is_error: true };
      const status = input.status as TodoItem["status"] | undefined;
      const priority = input.priority as Priority | undefined;
      const blocked_by = input.blocked_by as number[] | undefined;
      if (!status && !priority && !blocked_by)
        return { content: "Error: status, priority, or blocked_by required for 'update'", is_error: true };
      const item = todos.find((t) => t.id === id);
      if (!item) return { content: `Error: task #${id} not found`, is_error: true };
      if (blocked_by) {
        for (const depId of blocked_by) {
          if (!todos.find((t) => t.id === depId))
            return { content: `Error: dependency task #${depId} not found`, is_error: true };
          if (depId === id)
            return { content: `Error: task #${id} cannot depend on itself`, is_error: true };
        }
        item.blocked_by = blocked_by.length > 0 ? blocked_by : undefined;
      }
      if (status) {
        if (status === "in_progress" && item.blocked_by) {
          const pending = item.blocked_by.filter((d) => {
            const dep = todos.find((t) => t.id === d);
            return dep && dep.status !== "done";
          });
          if (pending.length > 0)
            return { content: `Error: task #${id} is blocked by incomplete tasks: #${pending.join(", #")}`, is_error: true };
        }
        item.status = status;
      }
      if (priority) item.priority = priority;
      const changes: string[] = [];
      if (status) changes.push(`status: ${status}`);
      if (priority) changes.push(`priority: ${priority}`);
      if (blocked_by) changes.push(`blocked_by: [${blocked_by.map((d) => `#${d}`).join(", ")}]`);
      return { content: `Updated task #${id} — ${changes.join(", ")}` };
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
  const meta: string[] = [];
  if (t.priority) meta.push(t.priority === "high" ? "‼" : t.priority === "medium" ? "!" : "·");
  if (t.blocked_by && t.blocked_by.length > 0) {
    const pending = t.blocked_by.filter((d) => {
      const dep = todos.find((x) => x.id === d);
      return dep && dep.status !== "done";
    });
    if (pending.length > 0) meta.push(`⊘#${pending.join(",#")}`);
  }
  const suffix = meta.length > 0 ? ` ${meta.join(" ")}` : "";
  return `${indent}${icon} #${t.id} [${t.status}] ${t.task}${suffix}`;
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
