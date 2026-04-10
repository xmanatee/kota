import type Anthropic from "@anthropic-ai/sdk";
import { getTaskProvider } from "../../modules/providers/index.js";
import type { Task, TaskPriority } from "../daemon/task-store.js";
import type { ToolResult } from "./index.js";

export type Priority = TaskPriority;
export type TodoItem = Task;

export const todoTool: Anthropic.Tool = {
  name: "todo",
  description:
    "Track tasks across sessions. Tasks persist on disk — resume work " +
    "after restarting. Supports subtasks (parent_id), priorities (high/medium/low), " +
    "dependencies (blocked_by), and notes. Use 'archive' to clear completed tasks. " +
    "The current todo list is always visible in your system context.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["add", "update", "list", "clear", "archive"],
        description:
          "add: create task. update: change status/priority/notes. " +
          "list: show all. clear: remove all. archive: remove completed.",
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
      notes: {
        type: "string",
        description:
          "Progress notes or context about a task (for 'add' or 'update'). " +
          "Useful for tracking findings, blockers, or intermediate results.",
      },
    },
    required: ["action"],
  },
};

export async function runTodo(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const action = input.action as string;
  const store = getTaskProvider();

  switch (action) {
    case "add": {
      const task = input.task as string;
      if (!task) return { content: "Error: task is required for 'add'", is_error: true };
      try {
        const item = store.add(task, {
          parent_id: input.parent_id as number | undefined,
          priority: input.priority as TaskPriority | undefined,
          blocked_by: input.blocked_by as number[] | undefined,
          notes: input.notes as string | undefined,
        });
        const parts: string[] = [];
        if (item.parent_id !== undefined) parts.push(`subtask of #${item.parent_id}`);
        if (item.priority) parts.push(`priority: ${item.priority}`);
        if (item.blocked_by) parts.push(`blocked by: #${item.blocked_by.join(", #")}`);
        const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        return { content: `Added task #${item.id}: ${task}${suffix}` };
      } catch (err) {
        return { content: `Error: ${(err as Error).message}`, is_error: true };
      }
    }
    case "update": {
      const id = input.id as number;
      if (!id) return { content: "Error: id is required for 'update'", is_error: true };
      const status = input.status as Task["status"] | undefined;
      const priority = input.priority as TaskPriority | undefined;
      const blocked_by = input.blocked_by as number[] | undefined;
      const notes = input.notes as string | undefined;
      if (!status && !priority && !blocked_by && notes === undefined)
        return { content: "Error: status, priority, blocked_by, or notes required for 'update'", is_error: true };
      try {
        store.update(id, { status, priority, blocked_by, notes });
        const changes: string[] = [];
        if (status) changes.push(`status: ${status}`);
        if (priority) changes.push(`priority: ${priority}`);
        if (blocked_by) changes.push(`blocked_by: [${blocked_by.map((d) => `#${d}`).join(", ")}]`);
        if (notes !== undefined) changes.push(`notes updated`);
        return { content: `Updated task #${id} — ${changes.join(", ")}` };
      } catch (err) {
        return { content: `Error: ${(err as Error).message}`, is_error: true };
      }
    }
    case "list": {
      return { content: formatTodos(store.list()) };
    }
    case "clear": {
      store.clear();
      return { content: "Cleared all tasks" };
    }
    case "archive": {
      const count = store.archiveCompleted();
      return {
        content: count > 0
          ? `Archived ${count} completed task${count > 1 ? "s" : ""}`
          : "No completed tasks to archive",
      };
    }
    default:
      return { content: `Error: unknown action '${action}'`, is_error: true };
  }
}

function formatItem(t: Task, allTasks: Task[], depth: number): string {
  const icon = t.status === "done" ? "✓" : t.status === "in_progress" ? "→" : "○";
  const indent = "  ".repeat(depth);
  const meta: string[] = [];
  if (t.priority) meta.push(t.priority === "high" ? "‼" : t.priority === "medium" ? "!" : "·");
  if (t.blocked_by && t.blocked_by.length > 0) {
    const pending = t.blocked_by.filter((d) => {
      const dep = allTasks.find((x) => x.id === d);
      return dep && dep.status !== "done";
    });
    if (pending.length > 0) meta.push(`⊘#${pending.join(",#")}`);
  }
  const suffix = meta.length > 0 ? ` ${meta.join(" ")}` : "";
  const noteSuffix = t.notes ? `\n${indent}  📝 ${t.notes}` : "";
  return `${indent}${icon} #${t.id} [${t.status}] ${t.task}${suffix}${noteSuffix}`;
}

function formatTodos(tasks: Task[]): string {
  if (tasks.length === 0) return "No tasks.";
  const lines: string[] = [];

  function renderTree(parentId: number | undefined, depth: number) {
    const items = tasks.filter((t) =>
      parentId === undefined ? t.parent_id === undefined : t.parent_id === parentId,
    );
    for (const item of items) {
      lines.push(formatItem(item, tasks, depth));
      renderTree(item.id, depth + 1);
    }
  }

  renderTree(undefined, 0);
  return lines.join("\n");
}

export function getTodoState(): string {
  const store = getTaskProvider();
  const tasks = store.list();
  if (tasks.length === 0) return "";
  // Show active tasks + up to 5 recent completed for context
  const active = tasks.filter(t => t.status !== "done");
  const completed = tasks.filter(t => t.status === "done");
  const recentCompleted = completed
    .sort((a, b) => (b.completed || b.created).localeCompare(a.completed || a.created))
    .slice(0, 5);
  const shown = [...active, ...recentCompleted];
  if (shown.length === 0) return "";
  const omitted = completed.length - recentCompleted.length;
  const omittedLine = omitted > 0 ? `\n(${omitted} older completed task${omitted > 1 ? "s" : ""} archived)` : "";
  return `\n<current-tasks>\n${formatTodos(shown)}${omittedLine}\n</current-tasks>`;
}
export const registration = {
	tool: todoTool,
	runner: runTodo,
	risk: "safe" as const,
	kind: "action" as const,
	group: "management",
};
