import type {
  UiActionParameterSpec,
  UiSurface,
  UiTableRow,
} from "#core/daemon/ui-surface.js";
import {
  action,
  readRole,
  readValue,
  resultSpec,
  type SurfaceRead,
  unavailableRows,
} from "#core/daemon/ui-surface-builders.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import type { RepoTaskListResult } from "./client.js";

const taskStateOptions = [
  { label: "Open", value: "open" },
  { label: "Blocked", value: "blocked" },
  { label: "Done", value: "done" },
  { label: "Dropped", value: "dropped" },
] as const;

const taskPriorityOptions = [
  { label: "P0", value: "p0" },
  { label: "P1", value: "p1" },
  { label: "P2", value: "p2" },
  { label: "P3", value: "p3" },
] as const;

const taskColumns = [
  { id: "name", label: "Task" },
  { id: "state", label: "Status", filterable: true },
  { id: "priority", label: "Priority", filterable: true },
  { id: "detail", label: "Blocked by", role: "muted" },
  { id: "id", label: "ID", role: "muted" },
] as const;

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function taskIdParameters(): UiActionParameterSpec {
  return {
    fields: [{ id: "taskId", label: "Task id", input: "text", required: true }],
    schema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string" } },
      additionalProperties: false,
    },
  };
}

function taskMoveParameters(): UiActionParameterSpec {
  return {
    fields: [
      { id: "taskId", label: "Task id", input: "text", required: true },
      {
        id: "state",
        label: "Status",
        input: "select",
        required: true,
        options: taskStateOptions,
      },
    ],
    schema: {
      type: "object",
      required: ["taskId", "state"],
      properties: {
        taskId: { type: "string" },
        state: { type: "string", enum: taskStateOptions.map((option) => option.value) },
      },
      additionalProperties: false,
    },
  };
}

function taskEditParameters(): UiActionParameterSpec {
  return {
    fields: [
      { id: "taskId", label: "Task id", input: "text", required: true },
      { id: "body", label: "Task details (Markdown)", input: "multiline", required: true },
    ],
    schema: {
      type: "object",
      required: ["taskId", "body"],
      properties: {
        taskId: { type: "string" },
        body: { type: "string" },
      },
      additionalProperties: false,
    },
  };
}

function taskCreateParameters(): UiActionParameterSpec {
  return {
    fields: [
      { id: "title", label: "Title", input: "text", required: true },
      {
        id: "priority",
        label: "Priority",
        input: "select",
        required: true,
        options: taskPriorityOptions,
      },
      {
        id: "state",
        label: "Initial state",
        input: "select",
        required: true,
        options: taskStateOptions.slice(0, 2),
      },
    ],
    schema: {
      type: "object",
      required: ["title", "priority", "state"],
      properties: {
        title: { type: "string" },
        priority: { type: "string", enum: ["p0", "p1", "p2", "p3"], default: "p2" },
        state: { type: "string", enum: ["open", "blocked"], default: "open" },
      },
      additionalProperties: false,
    },
  };
}

function taskRows(
  tasks: SurfaceRead<RepoTaskListResult>,
  moveAction: ReturnType<typeof action>,
): UiTableRow[] {
  if (!tasks.ok) return unavailableRows(tasks.message);
  return tasks.value.tasks.map((task) => ({
    id: task.id,
    cells: [
      { columnId: "name", value: task.title },
      {
        columnId: "state",
        value: titleCase(task.state),
        role: task.state === "blocked" ? "warn" : "info",
      },
      {
        columnId: "priority",
        value: task.priority?.toUpperCase() ?? "—",
        role: task.priority === "p0" ? "error" : task.priority === "p1" ? "warn" : "muted",
      },
      {
        columnId: "detail",
        value: task.waitingOnTasks.join(", ") || "—",
        role: "muted",
      },
      { columnId: "id", value: task.id, role: "muted" },
    ],
    action: moveAction,
  }));
}

function buildTasksUiSurface(
  scopeId: string,
  tasks: SurfaceRead<RepoTaskListResult>,
): UiSurface {
  const refresh = action({
    surfaceId: "tasks",
    actionId: "tasks.list",
    scopeId,
    label: "Refresh",
    operation: { kind: "client-namespace", namespace: "tasks", method: "list" },
    result: resultSpec("Tasks loaded."),
  });
  const show = action({
    surfaceId: "tasks",
    actionId: "task.show",
    scopeId,
    label: "View task",
    operation: { kind: "client-namespace", namespace: "tasks", method: "show" },
    parameters: taskIdParameters(),
    result: resultSpec("Task loaded."),
  });
  const move = action({
    surfaceId: "tasks",
    actionId: "task.move",
    scopeId,
    label: "Change status",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "tasks", method: "move" },
    parameters: taskMoveParameters(),
    result: resultSpec("Task moved."),
  });
  const edit = action({
    surfaceId: "tasks",
    actionId: "task.body.update",
    scopeId,
    label: "Edit task",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "tasks", method: "updateBody" },
    parameters: taskEditParameters(),
    result: resultSpec("Task updated."),
  });
  const create = action({
    surfaceId: "tasks",
    actionId: "task.create",
    scopeId,
    label: "Create task",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "tasks", method: "create" },
    parameters: taskCreateParameters(),
    result: resultSpec("Task created."),
  });
  const actions = [refresh, show, move, edit, create];

  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "tasks",
    extensionId: "repo-tasks.queue",
    title: "Tasks",
    intent: "Work",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Work" },
    order: 35,
    refreshEvents: ["task.created", "task.changed", "task.moved", "queue.changed"],
    permissions: [
      { kind: "capability-scope", scope: "control" },
      { kind: "effect", effect: "write" },
    ],
    nodes: [
      {
        kind: "status-summary",
        entries: [
          {
            label: "Open",
            value: readValue(tasks, (value) => `${value.tasks.filter((task) => task.state === "open").length}`),
            role: readRole(tasks),
          },
          {
            label: "Blocked",
            value: readValue(tasks, (value) => `${value.tasks.filter((task) => task.state === "blocked").length}`),
            role: readRole(tasks),
          },
          {
            label: "Waiting on dependencies",
            value: readValue(tasks, (value) => `${value.tasks.filter((task) => task.waitingOnTasks.length > 0).length}`),
            role: readRole(tasks),
          },
        ],
      },
      {
        kind: "table",
        title: "Tasks",
        columns: taskColumns,
        rows: taskRows(tasks, move),
        searchable: true,
      },
      { kind: "action-list", title: "Task actions", actions: [create, show, edit, refresh] },
    ],
    actions,
  };
}

export const repoTasksUiSurfaceSource: UiSurfaceSource = {
  sourceId: "tasks",
  scope: async (context) => {
    const tasks = await context.read("tasks", () =>
      context.client.tasks.list(["open", "blocked"]),
    );
    return [buildTasksUiSurface(context.scopeId, tasks)];
  },
};
