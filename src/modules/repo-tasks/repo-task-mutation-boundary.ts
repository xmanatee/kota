import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import type { ScopeId } from "#core/daemon/scope-registry.js";
import { getCurrentToolCallExecutionOptions } from "#core/tools/tool-runner-runtime.js";
import {
  type RunRepositoryAccess,
  requireRunWriterWorkspace,
} from "#core/workflow/run-context.js";
import { getWorkflowDispatcher } from "#core/workflow/workflow-dispatcher-provider.js";
import type {
  RepoTaskCaptureResult,
  RepoTaskCreateResult,
  RepoTaskMoveResult,
  RepoTaskPriority,
  RepoTaskState,
  RepoTaskUpdateBodyResult,
} from "./client.js";
import {
  getRepoInboxDir,
  moveTaskById,
  REPO_INBOX_DIR,
  REPO_TASK_STATES,
  readRepoInboxFile,
  removeRepoInboxFile,
  writeRepoInboxFile,
} from "./repo-tasks-domain.js";
import {
  captureInboxTask,
  createNormalizedTask,
  slugifyTaskTitle,
  updateTaskBody,
} from "./repo-tasks-operations.js";
import { isRepoTaskId } from "./task-id.js";

export type RepoTaskCanonicalMutationTarget = Readonly<{
	authority: "canonical";
  scopeId: ScopeId;
}>;

export type RepoTaskRuntimeSandboxTarget = Readonly<{
	authority: "runtime-owned-sandbox";
	repositoryAccess: RunRepositoryAccess;
}>;

export type RepoTaskMutationTarget =
	| RepoTaskCanonicalMutationTarget
	| RepoTaskRuntimeSandboxTarget;

type NormalizedCreateInput = Readonly<{
  title: string;
  priority: RepoTaskPriority;
  state?: "open" | "blocked";
}>;

type CreateRequest = Readonly<{ kind: "create"; options: NormalizedCreateInput }>;
type CaptureRequest = Readonly<{ kind: "capture"; title: string }>;
type CaptureInboxRequest = Readonly<{
  kind: "capture-inbox";
  id: string;
  content: string;
}>;
type MoveRequest = Readonly<{ kind: "move"; id: string; state: RepoTaskState }>;
type UpdateBodyRequest = Readonly<{ kind: "update-body"; id: string; body: string }>;
type RetractInboxRequest = Readonly<{ kind: "retract-inbox"; path: string }>;

export type RepoTaskMutationRequest =
  | CreateRequest
  | CaptureRequest
  | CaptureInboxRequest
  | MoveRequest
  | UpdateBodyRequest
  | RetractInboxRequest;

export type RepoTaskInboxRetractionResult =
  | Readonly<{ ok: true; path: string; recordId: string }>
  | Readonly<{ ok: false; reason: "not_found" }>;

export type RepoTaskMutationValue =
  | RepoTaskCreateResult
  | RepoTaskCaptureResult
  | RepoTaskMoveResult
  | RepoTaskUpdateBodyResult
  | RepoTaskInboxRetractionResult;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== "string") throw new Error(`Repo-task mutation requires string ${key}`);
  return value;
}

const REPO_TASK_PRIORITIES: readonly RepoTaskPriority[] = ["p0", "p1", "p2", "p3"];

function requirePriority(object: Record<string, unknown>, key: string): RepoTaskPriority {
  const value = requireString(object, key);
  if (!(REPO_TASK_PRIORITIES as readonly string[]).includes(value)) {
    throw new Error(`Repo-task mutation requires a valid ${key}`);
  }
  return value as RepoTaskPriority;
}

function requireState(object: Record<string, unknown>, key: string): RepoTaskState {
  const value = requireString(object, key);
  if (!(REPO_TASK_STATES as readonly string[]).includes(value)) {
    throw new Error(`Repo-task mutation requires a valid ${key}`);
  }
  return value as RepoTaskState;
}

function requireInboxId(object: Record<string, unknown>, key: string): string {
  const value = requireString(object, key);
  if (!/^note-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`Repo-task mutation requires a valid ${key}`);
  }
  return value;
}

export function decodeRepoTaskMutationRequest(value: unknown): RepoTaskMutationRequest {
  if (!isObject(value) || typeof value.kind !== "string") {
    throw new Error("Repo-task mutation request must be an object with a kind");
  }
  switch (value.kind) {
    case "create": {
      if (!isObject(value.options)) throw new Error("Repo-task create requires options");
      const options = value.options;
      return {
        kind: value.kind,
        options: {
          title: requireString(options, "title"),
          priority: requirePriority(options, "priority"),
          ...(options.state === undefined
            ? {}
            : { state: requireState(options, "state") as "open" | "blocked" }),
        },
      };
    }
    case "capture":
      return { kind: value.kind, title: requireString(value, "title") };
    case "capture-inbox":
      return {
        kind: value.kind,
        id: requireInboxId(value, "id"),
        content: requireString(value, "content"),
      };
    case "move":
      return {
        kind: value.kind,
        id: requireString(value, "id"),
        state: requireState(value, "state"),
      };
    case "update-body":
      return {
        kind: value.kind,
        id: requireString(value, "id"),
        body: requireString(value, "body"),
      };
    case "retract-inbox":
      return { kind: value.kind, path: requireString(value, "path") };
    default:
      throw new Error(`Unknown repo-task mutation kind "${value.kind}"`);
  }
}

function moveResult(repoRoot: string, id: string, state: RepoTaskState): RepoTaskMoveResult {
  try {
    return { ok: true, ...moveTaskById(repoRoot, id, state) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/invalid task id/i.test(message)) return { ok: false, reason: "invalid_id" };
    if (/not found/i.test(message)) return { ok: false, reason: "not_found" };
    if (/already in/i.test(message)) {
      return { ok: false, reason: "already_in_state", state };
    }
    throw error;
  }
}

function resolveInboxRetraction(
  repoRoot: string,
  path: string,
): { absolutePath: string; recordId: string } {
  const inboxDir = getRepoInboxDir(repoRoot);
  const absolute = resolve(repoRoot, path);
  const inside = relative(inboxDir, absolute);
  if (
    inside === ".." ||
    inside.startsWith(`..${sep}`) ||
    inside === "" ||
    inside.includes(sep) ||
    !inside.endsWith(".md")
  ) {
    throw new Error(`Refusing to retract inbox path outside ${REPO_INBOX_DIR}: ${path}`);
  }
  return {
    absolutePath: absolute,
    recordId: inside.replace(/\.md$/, ""),
  };
}

function retractInbox(repoRoot: string, path: string): RepoTaskInboxRetractionResult {
  const resolved = resolveInboxRetraction(repoRoot, path);
  if (!removeRepoInboxFile(repoRoot, resolved.absolutePath)) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, recordId: resolved.recordId, path };
}

function executeRepoTaskMutation(
  repoRoot: string,
  request: RepoTaskMutationRequest,
): RepoTaskMutationValue {
  switch (request.kind) {
    case "create":
      return createNormalizedTask(repoRoot, request.options);
    case "capture":
      return captureInboxTask(repoRoot, request.title);
    case "capture-inbox": {
      const path = join(getRepoInboxDir(repoRoot), `${request.id}.md`);
      if (readRepoInboxFile(repoRoot, path) !== null) {
        return { ok: false, reason: "already_exists" };
      }
      writeRepoInboxFile(repoRoot, path, request.content);
      return { ok: true, id: request.id, path: relative(repoRoot, path) };
    }
    case "move":
      return moveResult(repoRoot, request.id, request.state);
    case "update-body":
      return updateTaskBody(repoRoot, request.id, request.body);
    case "retract-inbox":
      return retractInbox(repoRoot, request.path);
  }
}

export function repoTaskMutationResources(
  repoRoot: string,
  request: RepoTaskMutationRequest,
): readonly string[] {
  if (request.kind === "move" || request.kind === "update-body") {
    return [`task:${request.id}`];
  }
  if (request.kind === "capture-inbox") return [`inbox:${request.id}`];
  if (request.kind === "retract-inbox") {
    return [`inbox:${resolveInboxRetraction(repoRoot, request.path).recordId}`];
  }
  if (request.kind === "create") {
    const slug = slugifyTaskTitle(request.options.title);
    return slug ? [`task:task-${slug}`] : ["repo-tasks:invalid-request"];
  }
  if (request.kind === "capture") {
    const slug = slugifyTaskTitle(request.title);
    return slug ? [`inbox:task-${slug}`] : ["repo-tasks:invalid-request"];
  }
  return ["repo-tasks:mutation"];
}

function preflightRepoTaskMutation(
  request: RepoTaskMutationRequest,
): RepoTaskMutationValue | null {
  if (request.kind === "move" && !isRepoTaskId(request.id)) {
    return { ok: false, reason: "invalid_id" };
  }
  if (request.kind === "update-body" && !isRepoTaskId(request.id)) {
    return { ok: false, reason: "invalid_id" };
  }
  return null;
}

async function executeCanonicalRepoTaskMutation(
  target: RepoTaskCanonicalMutationTarget,
  request: RepoTaskMutationRequest,
): Promise<RepoTaskMutationValue> {
  const dispatcher = getWorkflowDispatcher();
  if (dispatcher === null) {
    throw new Error("Repo-task mutation requires the active workflow runtime");
  }
  const execution = getCurrentToolCallExecutionOptions();
  const parentRunId = execution?.workflowContext?.runId;
  const result = await dispatcher.execute({
    workflow: "repo-task-mutation",
    scopeId: target.scopeId,
    event: "repo-task.mutation.requested",
    payload: { request },
    ...(parentRunId !== undefined
      ? {
          parent: {
            runId: parentRunId,
            triggerId: `repo-task:${createHash("sha256")
              .update(JSON.stringify(request))
              .digest("hex")}`,
          },
        }
      : {}),
    ...(execution?.signal !== undefined ? { signal: execution.signal } : {}),
  });
  if (!result.ok) throw new Error(result.error);
  if (!isObject(result.output) || typeof result.output.ok !== "boolean") {
    throw new Error("Repo-task mutation workflow returned an invalid result");
  }
  return result.output as RepoTaskMutationValue;
}

export function executeRepoTaskMutationInRun(
  access: RunRepositoryAccess | undefined,
  request: RepoTaskMutationRequest,
): RepoTaskMutationValue {
  return executeRepoTaskMutation(
    requireRunWriterWorkspace(access),
    decodeRepoTaskMutationRequest(request),
  );
}

export function mutateRepoTask(
  target: RepoTaskMutationTarget,
  request: CreateRequest,
): Promise<RepoTaskCreateResult>;
export function mutateRepoTask(
  target: RepoTaskMutationTarget,
  request: CaptureRequest,
): Promise<RepoTaskCaptureResult>;
export function mutateRepoTask(
  target: RepoTaskMutationTarget,
  request: CaptureInboxRequest,
): Promise<RepoTaskCaptureResult>;
export function mutateRepoTask(
  target: RepoTaskMutationTarget,
  request: MoveRequest,
): Promise<RepoTaskMoveResult>;
export function mutateRepoTask(
  target: RepoTaskMutationTarget,
  request: UpdateBodyRequest,
): Promise<RepoTaskUpdateBodyResult>;
export function mutateRepoTask(
  target: RepoTaskMutationTarget,
  request: RetractInboxRequest,
): Promise<RepoTaskInboxRetractionResult>;
export function mutateRepoTask(
  target: RepoTaskMutationTarget,
  request: RepoTaskMutationRequest,
): Promise<RepoTaskMutationValue>;
export async function mutateRepoTask(
  target: RepoTaskMutationTarget,
  request: RepoTaskMutationRequest,
): Promise<RepoTaskMutationValue> {
	const normalizedRequest = decodeRepoTaskMutationRequest(request);
	const preflight = preflightRepoTaskMutation(normalizedRequest);
	if (preflight !== null) return preflight;
	if (target.authority === "runtime-owned-sandbox") {
		return executeRepoTaskMutationInRun(target.repositoryAccess, normalizedRequest);
	}
	return await executeCanonicalRepoTaskMutation(target, normalizedRequest);
}
