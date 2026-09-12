import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type {
  AgentHarnessRunOptions,
  KotaMessage,
  KotaTool,
} from "#core/agent-harness/index.js";
import { decodeKotaMessages } from "#core/agent-harness/message-codec.js";
import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type { ResolvedProvider } from "#core/model/model-client.js";
import type { ResolvedModelOutputTokenLimit } from "#core/model/output-token-limits.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { agentConversationRoot, SessionRecoveryError } from "./session-continuity.js";

const SESSION_SCHEMA_VERSION = 1;
const SESSION_ID_PREFIX = "ots_";
const SESSION_ID_PATTERN = /^ots_[0-9a-f-]{36}$/;

export type ConversationSessionToolDeclaration = {
  name: string;
  source: "local" | "mcp";
  fingerprint: string;
};

export type ConversationSessionContext = {
  model: string;
  providerName: string;
  cwd: string;
  outputMaxTokens: number;
  providerSelection: {
    provider?: string;
    baseUrl?: string;
  };
  scope: {
    scopeId?: string;
  };
};

export type ConversationSessionRecord = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  id: string;
  harness: string;
  createdAt: string;
  updatedAt: string;
  context: ConversationSessionContext;
  toolDeclarations: ConversationSessionToolDeclaration[];
  messages: KotaMessage[];
  lastProviderMessageId?: string;
  adapterState?: KotaJsonValue;
};

export type PersistConversationSessionInput = {
  scopeRoot: string;
  harness?: string;
  existing?: ConversationSessionRecord;
  context: ConversationSessionContext;
  toolDeclarations: ConversationSessionToolDeclaration[];
  messages: KotaMessage[];
  lastProviderMessageId?: string;
  adapterState?: KotaJsonValue;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringifyJson(value: KotaJsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringifyJson(value[key] ?? null)}`)
    .join(",")}}`;
}

function clonedJson(value: object): KotaJsonValue {
  return JSON.parse(JSON.stringify(value)) as KotaJsonValue;
}

function cloneMessages(messages: readonly KotaMessage[]): KotaMessage[] {
  return JSON.parse(JSON.stringify(messages)) as KotaMessage[];
}

function assertSessionId(id: string): void {
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new Error(`Invalid conversation session id "${id}".`);
  }
}

function sessionPath(scopeRoot: string, id: string): string {
  assertSessionId(id);
  return join(agentConversationRoot(scopeRoot), `${id}.json`);
}

export function createConversationSessionId(): string {
  return `${SESSION_ID_PREFIX}${randomUUID()}`;
}

export function buildConversationSessionContext(input: {
  options: AgentHarnessRunOptions;
  scopeRoot: string;
  resolved: Pick<ResolvedProvider, "model" | "providerName">;
  outputTokenLimit: Pick<ResolvedModelOutputTokenLimit, "maxTokens">;
}): ConversationSessionContext {
  const executionScope = input.options.sessionContext ?? input.options.workflowContext;
  return {
    model: input.resolved.model,
    providerName: input.resolved.providerName,
    cwd: input.options.cwd ?? input.scopeRoot,
    outputMaxTokens: input.outputTokenLimit.maxTokens,
    providerSelection: {
      ...(input.options.modelProvider?.provider !== undefined
        ? { provider: input.options.modelProvider.provider }
        : {}),
      ...(input.options.modelProvider?.baseUrl !== undefined
        ? { baseUrl: input.options.modelProvider.baseUrl }
        : {}),
    },
    scope: {
      ...(executionScope?.scopeId !== undefined
        ? { scopeId: executionScope.scopeId }
        : {}),
    },
  };
}

export function loadConversationSession(
  scopeRoot: string,
  id: string,
): ConversationSessionRecord {
  const path = sessionPath(scopeRoot, id);
  if (!existsSync(path)) {
    throw new SessionRecoveryError(`Agent conversation "${id}" was not found in ${agentConversationRoot(scopeRoot)}.`);
  }
  const source = readFileSync(path, "utf8");
  let record: ConversationSessionRecord;
  try {
    record = decodeConversationSessionRecord(JSON.parse(source) as unknown, id);
  } catch {
    throw new SessionRecoveryError("The saved conversation is corrupt or uses an unsupported format; the original record was retained.");
  }
  return {
    ...record,
    messages: cloneMessages(record.messages),
    toolDeclarations: [...record.toolDeclarations],
  };
}

export function persistConversationSession(
  input: PersistConversationSessionInput,
): ConversationSessionRecord {
  const now = new Date().toISOString();
  const id = input.existing?.id ?? createConversationSessionId();
  const record: ConversationSessionRecord = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id,
    harness: input.harness ?? input.existing?.harness ?? "openai-tools",
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
    context: input.context,
    toolDeclarations: [...input.toolDeclarations].sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
    messages: cloneMessages(input.messages),
    ...(input.adapterState === undefined ? {} : { adapterState: input.adapterState }),
    ...(input.lastProviderMessageId !== undefined
      ? { lastProviderMessageId: input.lastProviderMessageId }
      : {}),
  };
  mkdirSync(agentConversationRoot(input.scopeRoot), { recursive: true, mode: 0o700 });
  writeJsonFileAtomic(sessionPath(input.scopeRoot, id), record, undefined, { mode: 0o600 });
  return {
    ...record,
    messages: cloneMessages(record.messages),
    toolDeclarations: [...record.toolDeclarations],
  };
}

function decodeConversationSessionRecord(value: unknown, expectedId: string): ConversationSessionRecord {
  const record = requireRecord(value);
  if (record.schemaVersion !== SESSION_SCHEMA_VERSION || typeof record.harness !== "string") {
    throw new Error(`Agent conversation "${expectedId}" has an unsupported record format.`);
  }
  if (record.id !== expectedId) {
    throw new Error(`Agent conversation "${expectedId}" record id mismatch.`);
  }
  requireString(record.createdAt, "createdAt");
  requireString(record.updatedAt, "updatedAt");
  const context = decodeSessionContext(record.context);
  if (!Array.isArray(record.toolDeclarations)) throw new Error("Agent conversation tool declarations are invalid.");
  const toolDeclarations = record.toolDeclarations.map<ConversationSessionToolDeclaration>((declaration) => {
    const item = requireRecord(declaration);
    requireString(item.name, "toolDeclarations.name");
    if (item.source !== "local" && item.source !== "mcp") {
      throw new Error("Agent conversation tool declaration source is invalid.");
    }
    const source = item.source === "local" ? "local" : "mcp";
    requireString(item.fingerprint, "toolDeclarations.fingerprint");
    return { name: item.name, source, fingerprint: item.fingerprint };
  });
  if (record.lastProviderMessageId !== undefined) {
    requireString(record.lastProviderMessageId, "lastProviderMessageId");
  }
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: expectedId,
    harness: record.harness,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    context,
    toolDeclarations,
    messages: decodeKotaMessages(record.messages, "messages"),
    ...(record.adapterState === undefined ? {} : { adapterState: z.json().parse(record.adapterState) }),
    ...(record.lastProviderMessageId !== undefined
      ? { lastProviderMessageId: record.lastProviderMessageId }
      : {}),
  };
}

function decodeSessionContext(value: unknown): ConversationSessionContext {
  const context = requireRecord(value);
  requireString(context.model, "context.model");
  requireString(context.providerName, "context.providerName");
  requireString(context.cwd, "context.cwd");
  if (typeof context.outputMaxTokens !== "number" || !Number.isFinite(context.outputMaxTokens)) {
    throw new Error("Agent conversation context.outputMaxTokens is invalid.");
  }
  const selection = requireRecord(context.providerSelection);
  if (selection.provider !== undefined) requireString(selection.provider, "context.providerSelection.provider");
  if (selection.baseUrl !== undefined) requireString(selection.baseUrl, "context.providerSelection.baseUrl");
  const scope = requireRecord(context.scope);
  if (scope.scopeId !== undefined) requireString(scope.scopeId, "context.scope.scopeId");
  return {
    model: context.model,
    providerName: context.providerName,
    cwd: context.cwd,
    outputMaxTokens: context.outputMaxTokens,
    providerSelection: {
      ...(selection.provider !== undefined ? { provider: selection.provider } : {}),
      ...(selection.baseUrl !== undefined ? { baseUrl: selection.baseUrl } : {}),
    },
    scope: scope.scopeId !== undefined ? { scopeId: scope.scopeId } : {},
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent conversation record is invalid.");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`Agent conversation ${field} is invalid.`);
}

export function snapshotConversationSessionToolDeclarations(
  tools: readonly KotaTool[],
  mcpFingerprints: ReadonlyMap<string, string> | undefined,
): ConversationSessionToolDeclaration[] {
  return [...tools]
    .map((tool) => {
      const mcpFingerprint = mcpFingerprints?.get(tool.name);
      if (mcpFingerprint !== undefined) {
        return {
          name: tool.name,
          source: "mcp" as const,
          fingerprint: mcpFingerprint,
        };
      }
      const material: KotaJsonValue = {
        version: "openai-tools-local-tool-v1",
        name: tool.name,
        description: tool.description,
        inputSchema: clonedJson(tool.input_schema),
        outputSchema:
          tool.output_schema === undefined ? null : clonedJson(tool.output_schema),
      };
      return {
        name: tool.name,
        source: "local" as const,
        fingerprint: sha256(stableStringifyJson(material)),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function validateConversationSessionContext(
  record: ConversationSessionRecord,
  current: ConversationSessionContext,
): void {
  const previous = record.context;
  if (previous.model !== current.model) {
    throw new SessionRecoveryError(
      `Agent conversation "${record.id}" was created for model "${previous.model}", not "${current.model}".`,
    );
  }
  if (previous.providerName !== current.providerName) {
    throw new SessionRecoveryError(
      `Agent conversation "${record.id}" was created for provider "${previous.providerName}", not "${current.providerName}".`,
    );
  }
  if (previous.outputMaxTokens !== current.outputMaxTokens) {
    throw new SessionRecoveryError(
      `Agent conversation "${record.id}" output-token capability changed from ${previous.outputMaxTokens} to ${current.outputMaxTokens}.`,
    );
  }
  if (
    previous.providerSelection.provider !== current.providerSelection.provider ||
    previous.providerSelection.baseUrl !== current.providerSelection.baseUrl
  ) {
    throw new SessionRecoveryError(
      `Agent conversation "${record.id}" provider selection changed and cannot be resumed safely.`,
    );
  }
  if (previous.cwd !== current.cwd) {
    throw new SessionRecoveryError(
      `Agent conversation "${record.id}" was created in "${previous.cwd}", not "${current.cwd}".`,
    );
  }
  if (previous.scope.scopeId !== current.scope.scopeId) {
    if (previous.scope.scopeId !== undefined && current.scope.scopeId === undefined) {
      throw new Error(
        `Agent conversation "${record.id}" requires scope "${previous.scope.scopeId}", but the current run has no scope.`,
      );
    }
    throw new Error(
      `Agent conversation "${record.id}" scope changed and cannot be resumed safely.`,
    );
  }
}

export function validateConversationSessionTools(
  record: ConversationSessionRecord,
  current: readonly ConversationSessionToolDeclaration[],
): void {
  const currentByName = new Map(current.map((entry) => [entry.name, entry]));
  for (const previous of record.toolDeclarations) {
    const next = currentByName.get(previous.name);
    if (next === undefined) {
      throw new SessionRecoveryError(
        `Agent conversation "${record.id}" references unavailable tool "${previous.name}".`,
      );
    }
    if (next.source !== previous.source || next.fingerprint !== previous.fingerprint) {
      throw new SessionRecoveryError(
        `Agent conversation "${record.id}" tool declaration for "${previous.name}" changed and cannot be resumed safely.`,
      );
    }
  }
}
