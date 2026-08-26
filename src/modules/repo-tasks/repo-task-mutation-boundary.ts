import { realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ScopeId } from "#core/daemon/scope-registry.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  LOGICAL_RESOURCE_AUTHORITY_PROVIDER_TYPE,
  type LogicalResourceAuthority,
} from "#core/workflow/logical-resource-authority.js";
import { RunSandboxManager } from "#core/workflow/run-sandbox.js";
import type { WorkflowRuntimeResources } from "#core/workflow/run-types.js";
import type {
  RepoTaskCaptureResult,
  RepoTaskCreateResult,
  RepoTaskGcOptions,
  RepoTaskGcResult,
  RepoTaskMoveResult,
  RepoTaskPriority,
  RepoTaskState,
  RepoTaskUpdateBodyResult,
} from "./client.js";
import { gcTerminalTasks } from "./repo-task-gc.js";
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
  scopeRoot: string;
}>;

export type RepoTaskRuntimeSandboxTarget = Readonly<{
	authority: "runtime-owned-sandbox";
	runId: string;
	workspaceRoot: string;
	scopeRoot: string;
	runtimeResources: WorkflowRuntimeResources;
}>;

export type RepoTaskMutationTarget =
	| RepoTaskCanonicalMutationTarget
	| RepoTaskRuntimeSandboxTarget;

type NormalizedCreateInput = Readonly<{
  title: string;
  priority: RepoTaskPriority;
  area: string;
  state: RepoTaskState;
  summary?: string;
}>;

type QuickCreateRequest = Readonly<{
  kind: "quick-create";
  id: string;
  title: string;
  summary: string;
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
type GcRequest = Readonly<{
  kind: "gc";
  options: Omit<RepoTaskGcOptions, "scopeId">;
}>;
type RetractInboxRequest = Readonly<{ kind: "retract-inbox"; path: string }>;

export type RepoTaskMutationRequest =
  | QuickCreateRequest
  | CreateRequest
  | CaptureRequest
  | CaptureInboxRequest
  | MoveRequest
  | UpdateBodyRequest
  | GcRequest
  | RetractInboxRequest;

export type RepoTaskInboxRetractionResult =
  | Readonly<{ ok: true; path: string; recordId: string }>
  | Readonly<{ ok: false; reason: "not_found" }>;

export type RepoTaskMutationValue =
  | RepoTaskCreateResult
  | RepoTaskCaptureResult
  | RepoTaskMoveResult
  | RepoTaskUpdateBodyResult
  | RepoTaskGcResult
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
    case "quick-create":
      return {
        kind: value.kind,
        id: requireString(value, "id"),
        title: requireString(value, "title"),
        summary: requireString(value, "summary"),
      };
    case "create": {
      if (!isObject(value.options)) throw new Error("Repo-task create requires options");
      const options = value.options;
      return {
        kind: value.kind,
        options: {
          title: requireString(options, "title"),
          priority: requirePriority(options, "priority"),
          area: requireString(options, "area"),
          state: requireState(options, "state"),
          ...(typeof options.summary === "string" ? { summary: options.summary } : {}),
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
    case "gc": {
      if (!isObject(value.options)) throw new Error("Repo-task gc requires options");
      const days = value.options.days;
      if (days !== undefined && (typeof days !== "number" || !Number.isFinite(days) || days <= 0)) {
        throw new Error("Repo-task gc days must be a positive number");
      }
      return {
        kind: value.kind,
        options: {
          ...(days !== undefined ? { days } : {}),
          ...(typeof value.options.dryRun === "boolean" ? { dryRun: value.options.dryRun } : {}),
        },
      };
    }
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
    case "quick-create": {
      if (!isRepoTaskId(request.id)) {
        return { ok: false, reason: "invalid_slug", message: "Invalid generated task id" };
      }
      const path = join(getRepoInboxDir(repoRoot), `${request.id}.md`);
      if (readRepoInboxFile(repoRoot, path) !== null) {
        return { ok: false, reason: "already_exists" };
      }
      writeRepoInboxFile(
        repoRoot,
        path,
        `# ${request.title}\n${request.summary ? `\n${request.summary}\n` : ""}`,
      );
      return { ok: true, id: request.id, path };
    }
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
      return { ok: true, id: request.id, path };
    }
    case "move":
      return moveResult(repoRoot, request.id, request.state);
    case "update-body":
      return updateTaskBody(repoRoot, request.id, request.body);
    case "gc":
      return gcTerminalTasks(repoRoot, request.options);
    case "retract-inbox":
      return retractInbox(repoRoot, request.path);
  }
}

function requireExistingRealPath(path: string, label: string): string {
	try {
		return realpathSync(path);
	} catch (error) {
		throw new Error(
			`Repo-task runtime-owned sandbox proof failed: ${label} is unavailable`,
			{ cause: error },
		);
	}
}

function requireRuntimeOwnedSandbox(
	target: RepoTaskRuntimeSandboxTarget,
): string {
	const repoRoot = requireExistingRealPath(target.workspaceRoot, "workspace");
	const scopeRoot = requireExistingRealPath(target.scopeRoot, "canonical scope root");
	const env = target.runtimeResources.env;
	const workspaceFromRuntime = requireExistingRealPath(
		env.KOTA_WORKSPACE_DIR ?? "",
		"KOTA_WORKSPACE_DIR",
	);
	const agentDir = requireExistingRealPath(
		env.KOTA_RUN_DIR ?? "",
		"KOTA_RUN_DIR",
	);
	const tempDir = requireExistingRealPath(
		env.KOTA_RUN_TEMP_DIR ?? "",
		"KOTA_RUN_TEMP_DIR",
	);
	const artifactDir = requireExistingRealPath(
		env.KOTA_RUN_ARTIFACT_DIR ?? "",
		"KOTA_RUN_ARTIFACT_DIR",
	);
	const declaredAgentDir = requireExistingRealPath(
		target.runtimeResources.agentRunDir ?? "",
		"runtimeResources.agentRunDir",
	);
	const declaredTempDir = requireExistingRealPath(
		target.runtimeResources.tempRoot ?? "",
		"runtimeResources.tempRoot",
	);
	const declaredArtifactDir = requireExistingRealPath(
		target.runtimeResources.artifactRoot ?? "",
		"runtimeResources.artifactRoot",
	);
	let ownedWorkspace: string;
	let ownedRoot: string;
	let ownedTemp: string;
	let ownedArtifacts: string;
	try {
		const reconciliation = new RunSandboxManager(scopeRoot).reconcile(
			target.runId,
			"write",
		);
		if (reconciliation.status !== "active") {
			throw new Error(`runtime allocation is ${reconciliation.status}`);
		}
		ownedWorkspace = requireExistingRealPath(
			reconciliation.sandbox.workspaceDir,
			"owned workspace",
		);
		ownedRoot = requireExistingRealPath(
			reconciliation.sandbox.rootDir,
			"owned run root",
		);
		ownedTemp = requireExistingRealPath(
			reconciliation.sandbox.tempDir,
			"owned temp root",
		);
		ownedArtifacts = requireExistingRealPath(
			reconciliation.sandbox.artifactDir,
			"owned artifact root",
		);
	} catch (error) {
		throw new Error(
			`Repo-task runtime-owned sandbox proof failed: runtime allocation "${target.runId}" is not an active writer sandbox for the canonical scope`,
			{ cause: error },
		);
	}
	const expectedProfilePrefix = `${target.runId}:`;
	const attempt = target.runtimeResources.profileId.slice(
		expectedProfilePrefix.length,
	);
	const valid =
		target.runtimeResources.profileId.startsWith(expectedProfilePrefix) &&
		/^[1-9]\d*$/.test(attempt) &&
		repoRoot === workspaceFromRuntime &&
		repoRoot === ownedWorkspace &&
		dirname(agentDir) === ownedRoot &&
		agentDir === declaredAgentDir &&
		tempDir === declaredTempDir &&
		tempDir === ownedTemp &&
		artifactDir === declaredArtifactDir &&
		artifactDir === ownedArtifacts;
	if (!valid) {
		throw new Error(
			"Repo-task runtime-owned sandbox proof failed: workspace and run resources do not describe one runtime allocation",
		);
	}
	return repoRoot;
}

function repoTaskMutationResources(
  repoRoot: string,
  request: RepoTaskMutationRequest,
): readonly string[] {
  if (request.kind === "move" || request.kind === "update-body") {
    return [`task:${request.id}`];
  }
  if (request.kind === "quick-create") return [`inbox:${request.id}`];
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
  const preview = gcTerminalTasks(repoRoot, {
    ...request.options,
    dryRun: true,
  });
  return [
    "repo-tasks:gc",
    ...preview.removed.map(
      (file) => `task:${file.replace(/\.md$/, "")}`,
    ),
  ];
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
  if (request.kind === "quick-create" && !isRepoTaskId(request.id)) {
    return { ok: false, reason: "invalid_slug", message: "Invalid generated task id" };
  }
  return null;
}

function withRepoTaskResources<T>(
  authority: LogicalResourceAuthority,
  scopeId: ScopeId,
  resources: readonly string[],
  operation: () => T,
  index = 0,
): T {
  const resourceKey = resources[index];
  if (resourceKey === undefined) return operation();
  return authority.withResourceAvailable({
    scopeId,
    resourceKey,
    operation: () => withRepoTaskResources(
      authority,
      scopeId,
      resources,
      operation,
      index + 1,
    ),
  });
}

function executeCanonicalRepoTaskMutation(
  target: RepoTaskCanonicalMutationTarget,
  request: RepoTaskMutationRequest,
): RepoTaskMutationValue {
  const operation = () => executeRepoTaskMutation(target.scopeRoot, request);
  const authority = getProviderRegistry()?.get(
    LOGICAL_RESOURCE_AUTHORITY_PROVIDER_TYPE,
  );
  if (authority === null || authority === undefined) return operation();
  const resources = [...new Set(repoTaskMutationResources(target.scopeRoot, request))]
    .sort();
  return withRepoTaskResources(authority, target.scopeId, resources, operation);
}

export function mutateRepoTask(
  target: RepoTaskMutationTarget,
  request: QuickCreateRequest | CreateRequest,
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
  request: GcRequest,
): Promise<RepoTaskGcResult>;
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
		return executeRepoTaskMutation(
			requireRuntimeOwnedSandbox(target),
			normalizedRequest,
		);
	}
	return executeCanonicalRepoTaskMutation(target, normalizedRequest);
}
