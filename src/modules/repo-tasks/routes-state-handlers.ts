import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse } from "#core/server/session-pool.js";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  type DaemonTaskStatusResponse,
  getRepoInboxDir,
  getRepoTasksDir,
  moveTaskById,
  type RepoTaskState,
} from "./repo-tasks-domain.js";
import { updateTaskBody } from "./repo-tasks-operations.js";
import { readRouteJsonBody } from "./route-body.js";
import {
  COUNTED_STATES,
  countMarkdownFiles,
  DETAIL_STATES,
  findTaskInOpenStates,
  listTaskFiles,
  readStateTasks,
} from "./route-task-files.js";

const ALLOWED_TARGET_STATES: readonly RepoTaskState[] = ["backlog", "ready", "blocked", "dropped"];

export async function handleTaskStateChange(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  projectDir = process.cwd(),
): Promise<void> {
  const body = await readRouteJsonBody(req, res);
  if (body === null) return;

  const newState = typeof body.state === "string" ? body.state : null;
  if (!newState || !(ALLOWED_TARGET_STATES as readonly string[]).includes(newState)) {
    jsonResponse(res, 400, { error: `state must be one of: ${ALLOWED_TARGET_STATES.join(", ")}` });
    return;
  }

  const tasksDir = getRepoTasksDir(projectDir);
  const found = findTaskInOpenStates(tasksDir, id);
  if (!found) {
    jsonResponse(res, 404, { error: "Task not found" });
    return;
  }

  if (found.state === newState) {
    jsonResponse(res, 200, { id, state: newState });
    return;
  }

  try {
    moveTaskById(projectDir, id, newState as RepoTaskState);
    jsonResponse(res, 200, { id, state: newState });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleTaskBodyUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  projectDir = process.cwd(),
): Promise<void> {
  const body = await readRouteJsonBody(req, res);
  if (body === null) return;

  const bodyText = typeof body.body === "string" ? body.body : null;
  if (bodyText === null) {
    jsonResponse(res, 400, { error: "body is required" });
    return;
  }

  try {
    const result = updateTaskBody(projectDir, id, bodyText);
    if (!result.ok) {
      if (result.reason === "terminal") {
        jsonResponse(res, 409, { error: "Task is in a terminal state and cannot be edited" });
        return;
      }
      if (result.reason === "malformed") {
        jsonResponse(res, 500, { error: "Could not parse task file" });
        return;
      }
      jsonResponse(res, 404, { error: "Task not found" });
      return;
    }
    const { attrs, body: parsedBody } = parseFlatFrontMatter(result.content);
    jsonResponse(res, 200, {
      id: attrs.id,
      title: attrs.title,
      priority: attrs.priority ?? "",
      area: attrs.area ?? "",
      summary: attrs.summary ?? "",
      body: parsedBody.trim(),
    });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleTaskStatus(
  res: ServerResponse,
  projectDir = process.cwd(),
): void {
  const tasksDir = getRepoTasksDir(projectDir);
  const inboxDir = getRepoInboxDir(projectDir);
  const counts = Object.fromEntries(
    COUNTED_STATES.map((state) => [
      state,
      state === "inbox" ? countMarkdownFiles(inboxDir) : listTaskFiles(tasksDir, state).length,
    ]),
  ) as DaemonTaskStatusResponse["counts"];
  const tasks = Object.fromEntries(
    DETAIL_STATES.map((state) => [state, readStateTasks(projectDir, tasksDir, state)]),
  ) as DaemonTaskStatusResponse["tasks"];
  jsonResponse(res, 200, { counts, tasks } satisfies DaemonTaskStatusResponse);
}
