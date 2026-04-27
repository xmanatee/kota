import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { getRepoTasksProvider } from "#core/modules/provider-registry.js";
import type {
  RepoTaskState as ContractRepoTaskState,
  RepoTaskCreateOptions,
  RepoTaskPriority,
} from "#core/server/kota-client.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { DaemonTaskDetail, DaemonTaskStatusResponse } from "./repo-tasks-domain.js";
import {
  getRepoInboxDir,
  getRepoTasksDir,
  moveTaskById,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "./repo-tasks-domain.js";
import {
  captureInboxTask,
  createNormalizedTask,
  gcTerminalTasks,
  showTask,
} from "./repo-tasks-operations.js";

const COUNTED_STATES = ["inbox", "ready", "backlog", "doing", "blocked"] as const;
const DETAIL_STATES = ["doing", "ready", "backlog", "blocked"] as const;
const OPEN_STATES: readonly RepoTaskState[] = ["backlog", "ready", "doing", "blocked"];
const ALLOWED_TARGET_STATES: readonly RepoTaskState[] = ["backlog", "ready", "blocked", "dropped"];
type AllowedTargetState = RepoTaskState;

function isMissingPathError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const code = String((error as { code?: unknown }).code ?? "");
  return code === "ENOENT" || code === "ENOTDIR";
}

function logGitStageFailure(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[kota] Task route ${action} failed to stage changes: ${message}`);
}

function listTaskFiles(tasksDir: string, state: string): string[] {
  const dir = join(tasksDir, state);
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
}

function countMarkdownFiles(dir: string): number {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md").length;
  } catch (error) {
    if (isMissingPathError(error)) {
      return 0;
    }
    throw error;
  }
}

function tryReadUtf8(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fields[key] = value;
  }
  return fields;
}

function extractBody(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return match ? match[1].trim() : "";
}

function readStateTasks(tasksDir: string, state: string): DaemonTaskDetail[] {
  const files = listTaskFiles(tasksDir, state);
  const result: DaemonTaskDetail[] = [];
  for (const file of files) {
    const content = tryReadUtf8(join(tasksDir, state, file));
    if (content === null) {
      continue;
    }
    const fm = parseFrontmatter(content);
    if (fm.id && fm.title) {
      result.push({
        id: fm.id,
        title: fm.title,
        priority: fm.priority ?? "",
        area: fm.area ?? "",
        summary: fm.summary ?? "",
        body: extractBody(content),
      });
    }
  }
  return result;
}

function findTaskInOpenStates(
  tasksDir: string,
  id: string,
): { state: string; filename: string; content: string } | null {
  for (const state of OPEN_STATES) {
    for (const file of listTaskFiles(tasksDir, state)) {
      const content = tryReadUtf8(join(tasksDir, state, file));
      if (content === null) {
        continue;
      }
      const fm = parseFrontmatter(content);
      if (fm.id === id) return { state, filename: file, content };
    }
  }
  return null;
}

function updateStatusFrontmatter(content: string, newStatus: string): string {
  return content.replace(/^(status:\s*)\S+/m, `$1${newStatus}`);
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function handleTaskStateChange(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  projectDir = process.cwd(),
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }

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

  const srcPath = join(tasksDir, found.state, found.filename);
  const destDir = join(tasksDir, newState);
  const destPath = join(destDir, found.filename);
  const updated = updateStatusFrontmatter(found.content, newState as AllowedTargetState);

  try {
    mkdirSync(destDir, { recursive: true });
    try {
      execFileSync("git", ["mv", srcPath, destPath], { cwd: projectDir });
    } catch {
      renameSync(srcPath, destPath);
      try {
        execFileSync("git", ["add", srcPath, destPath], { cwd: projectDir });
      } catch (error) {
        logGitStageFailure(`move ${found.filename}`, error);
      }
    }
    writeFileSync(destPath, updated, "utf-8");
    try {
      execFileSync("git", ["add", destPath], { cwd: projectDir });
    } catch (error) {
      logGitStageFailure(`write ${found.filename}`, error);
    }
    jsonResponse(res, 200, { id, state: newState });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleTaskCreate(
  req: IncomingMessage,
  res: ServerResponse,
  projectDir = process.cwd(),
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    jsonResponse(res, 400, { error: "title is required" });
    return;
  }
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";

  const slug = slugify(title);
  const suffix = Math.random().toString(36).slice(2, 7);
  const id = `task-${slug}-${suffix}`;
  const filename = `${id}.md`;
  const inboxDir = getRepoInboxDir(projectDir);
  const filePath = join(inboxDir, filename);
  try {
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(filePath, `# ${title}\n${summary ? `\n${summary}\n` : ""}`, "utf-8");
    try {
      execFileSync("git", ["add", filePath], { cwd: projectDir });
    } catch (error) {
      logGitStageFailure(`create ${filename}`, error);
    }
    jsonResponse(res, 201, { id, state: "inbox" });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

const TERMINAL_STATES = ["done", "dropped"] as const;

export async function handleTaskBodyUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  projectDir = process.cwd(),
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }

  const bodyText = typeof body.body === "string" ? body.body : null;
  if (bodyText === null) {
    jsonResponse(res, 400, { error: "body is required" });
    return;
  }

  const tasksDir = getRepoTasksDir(projectDir);

  for (const state of TERMINAL_STATES) {
    for (const file of listTaskFiles(tasksDir, state)) {
      const content = tryReadUtf8(join(tasksDir, state, file));
      if (content === null) {
        continue;
      }
      const fm = parseFrontmatter(content);
      if (fm.id === id) {
        jsonResponse(res, 409, { error: "Task is in a terminal state and cannot be edited" });
        return;
      }
    }
  }

  const found = findTaskInOpenStates(tasksDir, id);
  if (!found) {
    jsonResponse(res, 404, { error: "Task not found" });
    return;
  }

  const fmMatch = found.content.match(/^(---\r?\n[\s\S]*?\r?\n---)\r?\n[\s\S]*$/);
  if (!fmMatch) {
    jsonResponse(res, 500, { error: "Could not parse task file" });
    return;
  }

  const now = new Date().toISOString();
  const updatedFm = fmMatch[1].replace(/^(updated_at:\s*)\S+/m, `$1${now}`);
  const newContent = `${updatedFm}\n\n${bodyText.trim()}\n`;

  const filePath = join(tasksDir, found.state, found.filename);
  try {
    writeFileSync(filePath, newContent, "utf-8");
    try {
      execFileSync("git", ["add", filePath], { cwd: projectDir });
    } catch (error) {
      logGitStageFailure(`edit ${found.filename}`, error);
    }
    const fm = parseFrontmatter(newContent);
    jsonResponse(res, 200, {
      id: fm.id,
      title: fm.title,
      priority: fm.priority ?? "",
      area: fm.area ?? "",
      summary: fm.summary ?? "",
      body: extractBody(newContent),
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
    DETAIL_STATES.map((state) => [state, readStateTasks(tasksDir, state)]),
  ) as DaemonTaskStatusResponse["tasks"];
  jsonResponse(res, 200, { counts, tasks } satisfies DaemonTaskStatusResponse);
}

const TASK_STATE_PATTERN = /^\/api\/tasks\/([^/]+)\/state$/;
const TASK_BODY_PATTERN = /^\/api\/tasks\/([^/]+)\/body$/;
const TASK_MOVE_PATTERN = /^\/api\/tasks\/([^/]+)\/move$/;
const TASK_SHOW_PATTERN = /^\/api\/tasks\/([^/]+)$/;

const ALLOWED_PRIORITIES: readonly RepoTaskPriority[] = ["p0", "p1", "p2", "p3"];

function isRepoTaskState(value: unknown): value is ContractRepoTaskState {
  return typeof value === "string" && (REPO_TASK_STATES as readonly string[]).includes(value);
}

function isRepoTaskPriority(value: unknown): value is RepoTaskPriority {
  return typeof value === "string" && (ALLOWED_PRIORITIES as readonly string[]).includes(value);
}

function shouldHandleShowPath(path: string): boolean {
  if (!TASK_SHOW_PATTERN.test(path)) return false;
  // Reserve subpaths (/state, /body, /move, /normalized, /capture, /gc) for
  // their dedicated handlers.
  return ![
    "normalized",
    "capture",
    "gc",
  ].includes(path.slice("/api/tasks/".length));
}

export async function handleTaskShow(
  res: ServerResponse,
  id: string,
  projectDir = process.cwd(),
): Promise<void> {
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
  projectDir = process.cwd(),
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  if (!isRepoTaskState(body.state)) {
    jsonResponse(res, 400, {
      error: `state must be one of: ${REPO_TASK_STATES.join(", ")}`,
    });
    return;
  }
  try {
    const result = moveTaskById(projectDir, id, body.state);
    jsonResponse(res, 200, {
      id: result.id,
      fromState: result.fromState,
      toState: result.toState,
      path: result.path,
      previousPath: result.previousPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(message)) {
      jsonResponse(res, 404, { error: message });
      return;
    }
    if (/already in/i.test(message)) {
      jsonResponse(res, 409, { state: body.state, error: message });
      return;
    }
    jsonResponse(res, 500, { error: message });
  }
}

export async function handleTaskCreateNormalized(
  req: IncomingMessage,
  res: ServerResponse,
  projectDir = process.cwd(),
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  if (typeof body.title !== "string" || body.title.trim() === "") {
    jsonResponse(res, 400, { error: "title is required" });
    return;
  }
  if (!isRepoTaskPriority(body.priority)) {
    jsonResponse(res, 400, {
      error: `priority must be one of: ${ALLOWED_PRIORITIES.join(", ")}`,
    });
    return;
  }
  if (!isRepoTaskState(body.state)) {
    jsonResponse(res, 400, {
      error: `state must be one of: ${REPO_TASK_STATES.join(", ")}`,
    });
    return;
  }
  if (typeof body.area !== "string" || body.area.trim() === "") {
    jsonResponse(res, 400, { error: "area is required" });
    return;
  }
  const summary = typeof body.summary === "string" ? body.summary : undefined;

  const options: RepoTaskCreateOptions = {
    title: body.title,
    priority: body.priority,
    area: body.area,
    state: body.state,
    ...(summary !== undefined && { summary }),
  };
  const result = createNormalizedTask(projectDir, options);
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
  projectDir = process.cwd(),
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  if (typeof body.title !== "string" || body.title.trim() === "") {
    jsonResponse(res, 400, { error: "title is required" });
    return;
  }
  const result = captureInboxTask(projectDir, body.title);
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
  projectDir = process.cwd(),
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  const days = typeof body.days === "number" ? body.days : undefined;
  if (days !== undefined && (!Number.isFinite(days) || days <= 0)) {
    jsonResponse(res, 400, { error: "days must be a positive number" });
    return;
  }
  const result = gcTerminalTasks(projectDir, {
    ...(days !== undefined && { days }),
    ...(typeof body.delete === "boolean" && { delete: body.delete }),
    ...(typeof body.dryRun === "boolean" && { dryRun: body.dryRun }),
  });
  jsonResponse(res, 200, result);
}

async function handleTasksSearchControl(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/tasks/search", "http://127.0.0.1");
  const query = url.searchParams.get("q") ?? "";
  const semantic = url.searchParams.get("semantic") !== "false";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam
    ? Math.max(1, Number.parseInt(limitParam, 10) || 0)
    : 20;
  const stateParams = url.searchParams.getAll("state");
  const states = stateParams.filter((s): s is ContractRepoTaskState =>
    (REPO_TASK_STATES as readonly string[]).includes(s),
  );
  try {
    const provider = getRepoTasksProvider();
    if (semantic && !provider.supportsSemanticSearch()) {
      jsonResponse(res, 200, { ok: false, reason: "semantic_unavailable" });
      return;
    }
    const opts: { topK: number; states?: ContractRepoTaskState[] } = { topK: limit };
    if (states.length > 0) opts.states = states;
    const tasks = await provider.searchTasks(query, opts);
    jsonResponse(res, 200, { ok: true, tasks });
  } catch (err) {
    if (semantic) {
      jsonResponse(res, 200, { ok: false, reason: "semantic_unavailable" });
      return;
    }
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

async function handleTasksReindexControl(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await getRepoTasksProvider().reindex();
    jsonResponse(res, 200, result);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function taskControlRoutes(): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/tasks/search",
      capabilityScope: "read",
      handler: handleTasksSearchControl,
    },
    {
      method: "POST",
      path: "/tasks/reindex",
      capabilityScope: "control",
      handler: handleTasksReindexControl,
    },
  ];
}

export function taskRoutes(): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/tasks",
      handler: (_req, res) => handleTaskStatus(res),
    },
    {
      method: "POST",
      path: "/api/tasks",
      handler: (req, res) => handleTaskCreate(req, res),
    },
    {
      method: "POST",
      path: "/api/tasks/normalized",
      handler: (req, res) => handleTaskCreateNormalized(req, res),
    },
    {
      method: "POST",
      path: "/api/tasks/capture",
      handler: (req, res) => handleTaskCapture(req, res),
    },
    {
      method: "POST",
      path: "/api/tasks/gc",
      handler: (req, res) => handleTaskGc(req, res),
    },
    {
      method: "PATCH",
      path: "/api/tasks/",
      pathPattern: TASK_STATE_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(TASK_STATE_PATTERN);
        return handleTaskStateChange(req, res, match![1]);
      },
    },
    {
      method: "PATCH",
      path: "/api/tasks/",
      pathPattern: TASK_MOVE_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(TASK_MOVE_PATTERN);
        return handleTaskMove(req, res, match![1]);
      },
    },
    {
      method: "PATCH",
      path: "/api/tasks/",
      pathPattern: TASK_BODY_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(TASK_BODY_PATTERN);
        return handleTaskBodyUpdate(req, res, match![1]);
      },
    },
    {
      method: "GET",
      path: "/api/tasks/",
      pathPattern: TASK_SHOW_PATTERN,
      handler: (req, res) => {
        const path = new URL(req.url!, "http://localhost").pathname;
        if (!shouldHandleShowPath(path)) {
          jsonResponse(res, 404, { error: "Not found" });
          return;
        }
        const match = path.match(TASK_SHOW_PATTERN);
        return handleTaskShow(res, decodeURIComponent(match![1]));
      },
    },
  ];
}
