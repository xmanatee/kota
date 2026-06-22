import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  McpProtocolVersion,
  McpTaskStatus,
} from "./client.js";
import { isMcpProtocolVersion } from "./client.js";
import type { RemoteMcpTaskServerMatch } from "./remote-task-server-identity.js";

const STORE_VERSION = 1;
const DEFAULT_REMOTE_TASK_STORE_PATH = ".kota/mcp-remote-tasks.json";

export type PersistedRemoteMcpTaskHandle = {
  id: string;
  serverConfigName: string;
  serverDisplayName: string;
  serverFingerprint: string;
  serverMatch: RemoteMcpTaskServerMatch;
  toolName: string;
  toolDeclarationFingerprint?: string;
  taskId: string;
  protocolVersion: McpProtocolVersion;
  status: McpTaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number | null;
  pollIntervalMs?: number;
  pollCount: number;
  inputUpdateCount: number;
  startedAt: string;
  deadlineAt: string | null;
  updatedAt: string;
  lastDiagnostic?: string;
};

export interface RemoteMcpTaskStore {
  list(): Promise<PersistedRemoteMcpTaskHandle[]>;
  upsert(handle: PersistedRemoteMcpTaskHandle): Promise<void>;
  remove(id: string): Promise<void>;
}

type RemoteMcpTaskStoreFile = {
  version: typeof STORE_VERSION;
  tasks: PersistedRemoteMcpTaskHandle[];
};

type RemoteMcpTaskStoreFileCandidate = {
  version?: number;
  tasks?: PersistedRemoteMcpTaskHandle[];
};

export function remoteMcpTaskHandleId(
  serverConfigName: string,
  taskId: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify([serverConfigName, taskId]))
    .digest("hex");
}

export class MemoryRemoteMcpTaskStore implements RemoteMcpTaskStore {
  private readonly handles = new Map<string, PersistedRemoteMcpTaskHandle>();

  async list(): Promise<PersistedRemoteMcpTaskHandle[]> {
    return [...this.handles.values()].map(cloneHandle);
  }

  async upsert(handle: PersistedRemoteMcpTaskHandle): Promise<void> {
    this.handles.set(handle.id, cloneHandle(handle));
  }

  async remove(id: string): Promise<void> {
    this.handles.delete(id);
  }
}

export class FileRemoteMcpTaskStore implements RemoteMcpTaskStore {
  private readonly filePath: string;

  constructor(projectDir: string, filePath = join(projectDir, DEFAULT_REMOTE_TASK_STORE_PATH)) {
    this.filePath = filePath;
  }

  async list(): Promise<PersistedRemoteMcpTaskHandle[]> {
    return this.readFile().tasks.map(cloneHandle);
  }

  async upsert(handle: PersistedRemoteMcpTaskHandle): Promise<void> {
    const data = this.readFile();
    const next = [
      ...data.tasks.filter((entry) => entry.id !== handle.id),
      cloneHandle(handle),
    ].sort(compareHandles);
    this.writeFile({ version: STORE_VERSION, tasks: next });
  }

  async remove(id: string): Promise<void> {
    const data = this.readFile();
    const next = data.tasks.filter((entry) => entry.id !== id);
    if (next.length === data.tasks.length) return;
    this.writeFile({ version: STORE_VERSION, tasks: next });
  }

  private readFile(): RemoteMcpTaskStoreFile {
    if (!existsSync(this.filePath)) {
      return { version: STORE_VERSION, tasks: [] };
    }
    const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as RemoteMcpTaskStoreFileCandidate;
    if (parsed.version !== STORE_VERSION) {
      throw new Error(`Malformed remote MCP task store: version must be ${STORE_VERSION}`);
    }
    if (!Array.isArray(parsed.tasks)) {
      throw new Error("Malformed remote MCP task store: tasks must be an array");
    }
    return {
      version: STORE_VERSION,
      tasks: parsed.tasks.map(validateHandle),
    };
  }

  private writeFile(data: RemoteMcpTaskStoreFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, this.filePath);
  }
}

function validateHandle(
  handle: PersistedRemoteMcpTaskHandle,
  index: number,
): PersistedRemoteMcpTaskHandle {
  requireString(handle.id, `tasks[${index}].id`);
  requireString(handle.serverConfigName, `tasks[${index}].serverConfigName`);
  requireString(handle.serverDisplayName, `tasks[${index}].serverDisplayName`);
  requireString(handle.serverFingerprint, `tasks[${index}].serverFingerprint`);
  validateServerMatch(handle.serverMatch, `tasks[${index}].serverMatch`);
  requireString(handle.toolName, `tasks[${index}].toolName`);
  if (handle.toolDeclarationFingerprint !== undefined) {
    requireString(handle.toolDeclarationFingerprint, `tasks[${index}].toolDeclarationFingerprint`);
  }
  requireString(handle.taskId, `tasks[${index}].taskId`);
  if (!isMcpProtocolVersion(handle.protocolVersion)) {
    throw new Error(`Malformed remote MCP task store: tasks[${index}].protocolVersion is invalid`);
  }
  if (
    handle.status !== "working" &&
    handle.status !== "input_required" &&
    handle.status !== "completed" &&
    handle.status !== "failed" &&
    handle.status !== "cancelled"
  ) {
    throw new Error(`Malformed remote MCP task store: tasks[${index}].status is invalid`);
  }
  requireIsoTimestamp(handle.createdAt, `tasks[${index}].createdAt`);
  requireIsoTimestamp(handle.lastUpdatedAt, `tasks[${index}].lastUpdatedAt`);
  if (handle.ttlMs !== null && (!Number.isSafeInteger(handle.ttlMs) || handle.ttlMs <= 0)) {
    throw new Error(`Malformed remote MCP task store: tasks[${index}].ttlMs is invalid`);
  }
  if (
    handle.pollIntervalMs !== undefined &&
    (!Number.isSafeInteger(handle.pollIntervalMs) || handle.pollIntervalMs <= 0)
  ) {
    throw new Error(`Malformed remote MCP task store: tasks[${index}].pollIntervalMs is invalid`);
  }
  requireNonNegativeInteger(handle.pollCount, `tasks[${index}].pollCount`);
  requireNonNegativeInteger(handle.inputUpdateCount, `tasks[${index}].inputUpdateCount`);
  requireIsoTimestamp(handle.startedAt, `tasks[${index}].startedAt`);
  if (handle.deadlineAt !== null) {
    requireIsoTimestamp(handle.deadlineAt, `tasks[${index}].deadlineAt`);
  }
  requireIsoTimestamp(handle.updatedAt, `tasks[${index}].updatedAt`);
  if (handle.lastDiagnostic !== undefined) {
    requireString(handle.lastDiagnostic, `tasks[${index}].lastDiagnostic`);
  }
  return cloneHandle(handle);
}

function validateServerMatch(
  match: RemoteMcpTaskServerMatch | undefined,
  label: string,
): void {
  if (!match) {
    throw new Error(`Malformed remote MCP task store: ${label} is required`);
  }
  if (match.kind === "safe") return;
  if (match.kind === "ambiguous") {
    requireString(match.reason, `${label}.reason`);
    return;
  }
  throw new Error(`Malformed remote MCP task store: ${label}.kind is invalid`);
}

function requireString(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Malformed remote MCP task store: ${label} must be a non-empty string`);
  }
}

function requireIsoTimestamp(value: string, label: string): void {
  requireString(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Malformed remote MCP task store: ${label} must be a valid timestamp`);
  }
}

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Malformed remote MCP task store: ${label} must be a non-negative integer`);
  }
}

function cloneHandle(handle: PersistedRemoteMcpTaskHandle): PersistedRemoteMcpTaskHandle {
  return {
    ...handle,
    serverMatch: { ...handle.serverMatch },
  };
}

function compareHandles(
  left: PersistedRemoteMcpTaskHandle,
  right: PersistedRemoteMcpTaskHandle,
): number {
  return `${left.serverConfigName}\u0000${left.toolName}\u0000${left.taskId}`
    .localeCompare(`${right.serverConfigName}\u0000${right.toolName}\u0000${right.taskId}`);
}
