import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse } from "#core/server/session-pool.js";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  mutateRepoTask,
  type RepoTaskMutationTarget,
} from "./repo-task-mutation-boundary.js";
import {
  type DaemonTaskStatusResponse,
  getRepoInboxDir,
  getRepoTasksDir,
  type RepoTaskState,
} from "./repo-tasks-domain.js";
import { readRouteJsonBody } from "./route-body.js";
import {
  COUNTED_STATES,
  countMarkdownFiles,
  DETAIL_STATES,
  listTaskFiles,
  readStateTasks,
} from "./route-task-files.js";

const ALLOWED_TARGET_STATES: readonly RepoTaskState[] = ["backlog", "ready", "blocked", "dropped"];

export async function handleTaskStateChange(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  target: RepoTaskMutationTarget,
): Promise<void> {
  const body = await readRouteJsonBody(req, res);
  if (body === null) return;

  const newState = typeof body.state === "string" ? body.state : null;
  if (!newState || !(ALLOWED_TARGET_STATES as readonly string[]).includes(newState)) {
    jsonResponse(res, 400, { error: `state must be one of: ${ALLOWED_TARGET_STATES.join(", ")}` });
    return;
  }

  try {
    const result = await mutateRepoTask(target, {
      kind: "move",
      id,
      state: newState as RepoTaskState,
    });
    if (!result.ok) {
      if (result.reason === "not_found") {
        jsonResponse(res, 404, { error: "Task not found" });
        return;
      }
      if (result.reason === "already_in_state") {
        jsonResponse(res, 200, { id, state: newState });
        return;
      }
      jsonResponse(res, 400, { error: "Invalid task id" });
      return;
    }
    jsonResponse(res, 200, { id, state: newState });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleTaskBodyUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  target: RepoTaskMutationTarget,
): Promise<void> {
  const body = await readRouteJsonBody(req, res);
  if (body === null) return;

  const bodyText = typeof body.body === "string" ? body.body : null;
  if (bodyText === null) {
    jsonResponse(res, 400, { error: "body is required" });
    return;
  }

  try {
    const result = await mutateRepoTask(target, {
      kind: "update-body",
      id,
      body: bodyText,
    });
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
  repoRoot = process.cwd(),
): void {
  const tasksDir = getRepoTasksDir(repoRoot);
  const inboxDir = getRepoInboxDir(repoRoot);
  const counts = Object.fromEntries(
    COUNTED_STATES.map((state) => [
      state,
      state === "inbox" ? countMarkdownFiles(inboxDir) : listTaskFiles(tasksDir, state).length,
    ]),
  ) as DaemonTaskStatusResponse["counts"];
  const tasks = Object.fromEntries(
    DETAIL_STATES.map((state) => [state, readStateTasks(repoRoot, tasksDir, state)]),
  ) as DaemonTaskStatusResponse["tasks"];
  jsonResponse(res, 200, { counts, tasks } satisfies DaemonTaskStatusResponse);
}
