import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse } from "#core/server/session-pool.js";
import type {
  RepoTaskState as ContractRepoTaskState,
  RepoTaskCreateOptions,
  RepoTaskPriority,
} from "./client.js";
import {
  mutateRepoTask,
  type RepoTaskMutationTarget,
} from "./repo-task-mutation-boundary.js";
import { REPO_TASK_STATES } from "./repo-tasks-domain.js";
import { showTask } from "./repo-tasks-operations.js";
import { readRouteJsonBody } from "./route-body.js";
import { isRepoTaskId } from "./task-id.js";

const ALLOWED_PRIORITIES: readonly RepoTaskPriority[] = ["p0", "p1", "p2", "p3"];

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isRepoTaskState(value: string): value is ContractRepoTaskState {
  return typeof value === "string" && (REPO_TASK_STATES as readonly string[]).includes(value);
}

function isRepoTaskPriority(value: string): value is RepoTaskPriority {
  return typeof value === "string" && (ALLOWED_PRIORITIES as readonly string[]).includes(value);
}

export async function handleTaskCreate(
  req: IncomingMessage,
  res: ServerResponse,
  target: RepoTaskMutationTarget,
): Promise<void> {
  const body = await readRouteJsonBody(req, res);
  if (body === null) return;

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    jsonResponse(res, 400, { error: "title is required" });
    return;
  }
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const id = `task-${slugify(title)}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    const result = await mutateRepoTask(target, {
      kind: "quick-create",
      id,
      title,
      summary,
    });
    if (!result.ok) {
      jsonResponse(res, 400, { reason: result.reason, error: result.message });
      return;
    }
    jsonResponse(res, 201, { id: result.id, state: "inbox" });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleTaskShow(
  res: ServerResponse,
  id: string,
  projectDir = process.cwd(),
): Promise<void> {
  if (!isRepoTaskId(id)) {
    jsonResponse(res, 400, { error: "Invalid task id" });
    return;
  }

  const result = showTask(projectDir, id);
  if (!result.found) {
    jsonResponse(res, 404, { error: `Task "${id}" not found.` });
    return;
  }
  jsonResponse(res, 200, { state: result.state, content: result.content });
}

export async function handleTaskMove(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  target: RepoTaskMutationTarget,
): Promise<void> {
  if (!isRepoTaskId(id)) {
    jsonResponse(res, 400, { reason: "invalid_id", error: "Invalid task id" });
    return;
  }

  const body = await readRouteJsonBody(req, res);
  if (body === null) return;

  const state = typeof body.state === "string" && isRepoTaskState(body.state) ? body.state : null;
  if (state === null) {
    jsonResponse(res, 400, {
      error: `state must be one of: ${REPO_TASK_STATES.join(", ")}`,
    });
    return;
  }
  try {
    const result = await mutateRepoTask(target, { kind: "move", id, state });
    if (!result.ok) {
      if (result.reason === "invalid_id") {
        jsonResponse(res, 400, { reason: result.reason, error: "Invalid task id" });
        return;
      }
      if (result.reason === "not_found") {
        jsonResponse(res, 404, { reason: result.reason, error: `Task "${id}" not found` });
        return;
      }
      jsonResponse(res, 409, {
        reason: result.reason,
        state: result.state,
        error: `Task "${id}" is already in "${state}"`,
      });
      return;
    }
    jsonResponse(res, 200, {
      id: result.id,
      fromState: result.fromState,
      toState: result.toState,
      path: result.path,
      previousPath: result.previousPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/invalid task id/i.test(message)) {
      jsonResponse(res, 400, { reason: "invalid_id", error: "Invalid task id" });
      return;
    }
    if (/not found/i.test(message)) {
      jsonResponse(res, 404, { error: message });
      return;
    }
    if (/already in/i.test(message)) {
      jsonResponse(res, 409, { state, error: message });
      return;
    }
    jsonResponse(res, 500, { error: message });
  }
}

export async function handleTaskCreateNormalized(
  req: IncomingMessage,
  res: ServerResponse,
  target: RepoTaskMutationTarget,
): Promise<void> {
  const body = await readRouteJsonBody(req, res);
  if (body === null) return;

  if (typeof body.title !== "string" || body.title.trim() === "") {
    jsonResponse(res, 400, { error: "title is required" });
    return;
  }
  const priority =
    typeof body.priority === "string" && isRepoTaskPriority(body.priority)
      ? body.priority
      : null;
  if (priority === null) {
    jsonResponse(res, 400, {
      error: `priority must be one of: ${ALLOWED_PRIORITIES.join(", ")}`,
    });
    return;
  }
  const state = typeof body.state === "string" && isRepoTaskState(body.state) ? body.state : null;
  if (state === null) {
    jsonResponse(res, 400, {
      error: `state must be one of: ${REPO_TASK_STATES.join(", ")}`,
    });
    return;
  }
  if (typeof body.area !== "string" || body.area.trim() === "") {
    jsonResponse(res, 400, { error: "area is required" });
    return;
  }

  const options: RepoTaskCreateOptions = {
    title: body.title,
    priority,
    area: body.area,
    state,
    ...(typeof body.summary === "string" && { summary: body.summary }),
  };
  const result = await mutateRepoTask(target, { kind: "create", options });
  if (!result.ok) {
    const status = result.reason === "already_exists" ? 409 : 400;
    jsonResponse(res, status, { reason: result.reason, error: result.message });
    return;
  }
  jsonResponse(res, 201, { id: result.id, path: result.path });
}

export async function handleTaskCapture(
  req: IncomingMessage,
  res: ServerResponse,
  target: RepoTaskMutationTarget,
): Promise<void> {
  const body = await readRouteJsonBody(req, res);
  if (body === null) return;

  if (typeof body.title !== "string" || body.title.trim() === "") {
    jsonResponse(res, 400, { error: "title is required" });
    return;
  }
  const result = await mutateRepoTask(target, { kind: "capture", title: body.title });
  if (!result.ok) {
    const status = result.reason === "already_exists" ? 409 : 400;
    jsonResponse(res, status, { reason: result.reason, error: result.message });
    return;
  }
  jsonResponse(res, 201, { id: result.id, path: result.path });
}

export async function handleTaskGc(
  req: IncomingMessage,
  res: ServerResponse,
  target: RepoTaskMutationTarget,
): Promise<void> {
  const body = await readRouteJsonBody(req, res);
  if (body === null) return;

  const days = typeof body.days === "number" ? body.days : undefined;
  if (days !== undefined && (!Number.isFinite(days) || days <= 0)) {
    jsonResponse(res, 400, { error: "days must be a positive number" });
    return;
  }
  const result = await mutateRepoTask(target, {
    kind: "gc",
    options: {
      ...(days !== undefined && { days }),
      ...(typeof body.dryRun === "boolean" && { dryRun: body.dryRun }),
    },
  });
  jsonResponse(res, 200, result);
}
