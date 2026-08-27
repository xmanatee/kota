import type {
  UiActionParameterSpec,
  UiSurface,
  UiTableRow,
} from "#core/daemon/ui-surface.js";
import {
  action,
  emptyRows,
  NAME_STATE_DETAIL_COLUMNS,
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
        label: "Target state",
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
      { id: "body", label: "Markdown body", input: "multiline", required: true },
    ],
    schema: {
      type: "object",
      required: ["taskId", "body"],
      properties: {
        taskId: { type: "string" },
        body: { type: "string", description: "Replaces the content after the task's front matter." },
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
        options: [
          { label: "P0", value: "p0" },
          { label: "P1", value: "p1" },
          { label: "P2", value: "p2" },
          { label: "P3", value: "p3" },
        ],
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
  if (tasks.value.tasks.length === 0) return emptyRows("Open tasks");
  return tasks.value.tasks.map((task) => ({
    id: task.id,
    cells: [
      { columnId: "name", value: task.title, role: task.priority === "p1" ? "warn" : "neutral" },
      { columnId: "state", value: `${task.priority} · ${task.state}`, role: task.state === "blocked" ? "warn" : "muted" },
      {
        columnId: "detail",
        value: task.waitingOnTasks.length > 0
          ? `${task.id} · waiting on ${task.waitingOnTasks.join(", ")}`
          : task.id,
        role: "muted",
      },
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
    label: "Reload tasks",
    operation: { kind: "client-namespace", namespace: "tasks", method: "list" },
    result: resultSpec("Tasks loaded."),
  });
  const show = action({
    surfaceId: "tasks",
    actionId: "task.show",
    scopeId,
    label: "Inspect task",
    operation: { kind: "client-namespace", namespace: "tasks", method: "show" },
    parameters: taskIdParameters(),
    result: resultSpec("Task loaded."),
  });
  const move = action({
    surfaceId: "tasks",
    actionId: "task.move",
    scopeId,
    label: "Move task",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "tasks", method: "move" },
    parameters: taskMoveParameters(),
    confirmation: {
      mode: "required",
      title: "Move task",
      detail: "This changes the task queue state and stages the canonical task-file mutation.",
      confirmLabel: "Move task",
      risk: "medium",
    },
    result: resultSpec("Task moved."),
  });
  const edit = action({
    surfaceId: "tasks",
    actionId: "task.body.update",
    scopeId,
    label: "Update task body",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "tasks", method: "updateBody" },
    parameters: taskEditParameters(),
    confirmation: {
      mode: "required",
      title: "Replace task body",
      detail: "The task front matter is preserved and the supplied markdown replaces its body.",
      confirmLabel: "Update body",
      risk: "medium",
    },
    result: resultSpec("Task body updated."),
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
        entries: [{
          label: "Open tasks",
          value: readValue(tasks, (value) => `${value.tasks.length}`),
          role: readRole(tasks),
        }],
      },
      { kind: "table", title: "Open task queue", columns: NAME_STATE_DETAIL_COLUMNS, rows: taskRows(tasks, move) },
      { kind: "form", title: "Inspect task markdown", fields: taskIdParameters().fields, submit: show },
      { kind: "form", title: "Edit task markdown", fields: taskEditParameters().fields, submit: edit },
      { kind: "form", title: "Create normalized task", fields: taskCreateParameters().fields, submit: create },
      { kind: "action-list", title: "Task actions", actions },
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
