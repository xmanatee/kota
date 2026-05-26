import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  McpClientTransportConfig,
  McpEnterpriseManagedAuthorizationConfig,
  McpOAuthAuthorizationCodeConfig,
  McpOAuthClientCredentialsAuthorizationConfig,
  McpOAuthClientCredentialsClientConfig,
  McpOAuthClientIdentityConfig,
  McpProtocolVersion,
  McpStreamableHttpAuthorizationConfig,
  McpTaskStatus,
} from "./client.js";
import { isMcpProtocolVersion } from "./client.js";
import { stableRecordEntries } from "./client-authorization-protocol.js";

const STORE_VERSION = 1;
const DEFAULT_REMOTE_TASK_STORE_PATH = ".kota/mcp-remote-tasks.json";

export type RemoteMcpTaskServerMatch =
  | { kind: "safe" }
  | { kind: "ambiguous"; reason: string };

export type RemoteMcpServerIdentity = {
  fingerprint: string;
  match: RemoteMcpTaskServerMatch;
};

export type PersistedRemoteMcpTaskHandle = {
  id: string;
  serverConfigName: string;
  serverDisplayName: string;
  serverFingerprint: string;
  serverMatch: RemoteMcpTaskServerMatch;
  toolName: string;
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

export function remoteMcpServerIdentity(
  transport: McpClientTransportConfig,
): RemoteMcpServerIdentity {
  const input = remoteMcpServerIdentityInput(transport);
  return {
    fingerprint: createHash("sha256").update(JSON.stringify(input.value)).digest("hex"),
    match: input.match,
  };
}

function remoteMcpServerIdentityInput(
  transport: McpClientTransportConfig,
): { value: object; match: RemoteMcpTaskServerMatch } {
  if (transport.type === "http") {
    const headerNames = stableRecordEntries(transport.headers)
      .map(([key]) => key.toLowerCase())
      .sort();
    return {
      value: {
        type: "http",
        url: new URL(transport.url).toString(),
        headerNames,
        authorization: redactedAuthorizationFingerprintInput(transport.authorization),
      },
      match: headerNames.length > 0
        ? {
            kind: "ambiguous",
            reason:
              "HTTP headers contain values that are intentionally not persisted, so this task cannot be matched safely after restart.",
          }
        : { kind: "safe" },
    };
  }

  const envKeys = stableRecordEntries(transport.env)
    .map(([key]) => key)
    .sort();
  return {
    value: {
      type: "stdio",
      command: transport.command,
      args: transport.args ?? [],
      envKeys,
    },
    match: envKeys.length > 0
      ? {
          kind: "ambiguous",
          reason:
            "stdio environment values are intentionally not persisted, so this task cannot be matched safely after restart.",
        }
      : { kind: "safe" },
  };
}

function redactedAuthorizationFingerprintInput(
  authorization: McpStreamableHttpAuthorizationConfig | undefined,
): object | null {
  if (!authorization) return null;
  if (authorization.type === "oauth") {
    return oauthAuthorizationFingerprintInput(authorization);
  }
  if (authorization.type === "oauth-client-credentials") {
    return oauthClientCredentialsFingerprintInput(authorization);
  }
  return enterpriseManagedFingerprintInput(authorization);
}

function oauthAuthorizationFingerprintInput(
  authorization: McpOAuthAuthorizationCodeConfig,
): object {
  return {
    type: authorization.type,
    issuer: authorization.issuer,
    redirectUri: authorization.redirectUri,
    scopes: authorization.scopes,
    client: oauthClientIdentityFingerprintInput(authorization.client),
  };
}

function oauthClientIdentityFingerprintInput(
  client: McpOAuthClientIdentityConfig,
): object {
  if (client.kind === "registered") {
    return {
      kind: client.kind,
      clientId: client.clientId,
      hasClientSecret: client.clientSecret !== undefined,
    };
  }
  if (client.kind === "client-id-metadata-url") {
    return {
      kind: client.kind,
      clientId: client.clientId,
    };
  }
  return {
    kind: client.kind,
    clientName: client.clientName,
    dynamicClientRegistration: client.dynamicClientRegistration,
  };
}

function oauthClientCredentialsFingerprintInput(
  authorization: McpOAuthClientCredentialsAuthorizationConfig,
): object {
  return {
    type: authorization.type,
    issuer: authorization.issuer,
    scopes: authorization.scopes,
    tokenEndpointAuthMethod: authorization.tokenEndpointAuthMethod,
    client: oauthClientCredentialsClientFingerprintInput(authorization.client),
  };
}

function oauthClientCredentialsClientFingerprintInput(
  client: McpOAuthClientCredentialsClientConfig,
): object {
  if ("clientSecret" in client) {
    return {
      kind: client.kind,
      clientId: client.clientId,
      credential: "client_secret",
    };
  }
  return {
    kind: client.kind,
    clientId: client.clientId,
    credential: "private_key_jwt",
    signingAlgorithm: client.signingAlgorithm,
    hasKeyId: client.keyId !== undefined,
  };
}

function enterpriseManagedFingerprintInput(
  authorization: McpEnterpriseManagedAuthorizationConfig,
): object {
  return {
    type: authorization.type,
    issuer: authorization.issuer,
    resource: authorization.resource,
    scopes: authorization.scopes,
    identityProvider: authorization.identityProvider,
    subjectToken: {
      tokenType: authorization.subjectToken.tokenType,
      source: authorization.subjectToken.source.kind === "env"
        ? authorization.subjectToken.source
        : { kind: "static", hasToken: true },
    },
    tokenEndpointAuthMethod: authorization.tokenEndpointAuthMethod,
    client: oauthClientCredentialsClientFingerprintInput(authorization.client),
  };
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
