import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentHarnessRunOptions,
  KotaMessage,
  KotaTool,
} from "#core/agent-harness/index.js";
import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type { ResolvedProvider } from "#core/model/model-client.js";
import type { ResolvedModelOutputTokenLimit } from "#core/model/output-token-limits.js";

const SESSION_SCHEMA_VERSION = 1;
const SESSION_ID_PREFIX = "ots_";
const SESSION_ID_PATTERN = /^ots_[0-9a-f-]{36}$/;
const MAX_SESSION_MESSAGES = 80;
const MAX_SESSION_JSON_BYTES = 2 * 1024 * 1024;

export type OpenaiToolsSessionToolDeclaration = {
  name: string;
  source: "local" | "mcp";
  fingerprint: string;
};

export type OpenaiToolsSessionContext = {
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
    projectId?: string;
  };
};

export type OpenaiToolsSessionRecord = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  id: string;
  harness: "openai-tools";
  createdAt: string;
  updatedAt: string;
  context: OpenaiToolsSessionContext;
  toolDeclarations: OpenaiToolsSessionToolDeclaration[];
  messages: KotaMessage[];
  lastProviderMessageId?: string;
};

export type PersistOpenaiToolsSessionInput = {
  projectDir: string;
  existing?: OpenaiToolsSessionRecord;
  context: OpenaiToolsSessionContext;
  toolDeclarations: OpenaiToolsSessionToolDeclaration[];
  messages: KotaMessage[];
  lastProviderMessageId?: string;
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

function sessionRoot(projectDir: string): string {
  return join(projectDir, ".kota", "openai-tools-agent-harness", "sessions");
}

function assertSessionId(id: string): void {
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new Error(`Invalid openai-tools session id "${id}".`);
  }
}

function sessionPath(projectDir: string, id: string): string {
  assertSessionId(id);
  return join(sessionRoot(projectDir), `${id}.json`);
}

export function createOpenaiToolsSessionId(): string {
  return `${SESSION_ID_PREFIX}${randomUUID()}`;
}

export function buildOpenaiToolsSessionContext(input: {
  options: AgentHarnessRunOptions;
  projectDir: string;
  resolved: ResolvedProvider;
  outputTokenLimit: ResolvedModelOutputTokenLimit;
}): OpenaiToolsSessionContext {
  const executionScope = input.options.sessionContext ?? input.options.workflowContext;
  return {
    model: input.resolved.model,
    providerName: input.resolved.providerName,
    cwd: input.projectDir,
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
      ...(executionScope?.projectId !== undefined
        ? { projectId: executionScope.projectId }
        : {}),
    },
  };
}

export function loadOpenaiToolsSession(
  projectDir: string,
  id: string,
): OpenaiToolsSessionRecord {
  const path = sessionPath(projectDir, id);
  if (!existsSync(path)) {
    throw new Error(`OpenAI tools session "${id}" was not found in ${sessionRoot(projectDir)}.`);
  }
  const record = JSON.parse(readFileSync(path, "utf8")) as OpenaiToolsSessionRecord;
  if (record.schemaVersion !== SESSION_SCHEMA_VERSION || record.harness !== "openai-tools") {
    throw new Error(`OpenAI tools session "${id}" has an unsupported record format.`);
  }
  if (record.id !== id) {
    throw new Error(`OpenAI tools session "${id}" record id mismatch.`);
  }
  return {
    ...record,
    messages: cloneMessages(record.messages),
    toolDeclarations: [...record.toolDeclarations],
  };
}

function boundedMessages(messages: readonly KotaMessage[]): KotaMessage[] {
  let bounded = cloneMessages(messages).slice(-MAX_SESSION_MESSAGES);
  while (
    bounded.length > 1 &&
    Buffer.byteLength(JSON.stringify(bounded), "utf8") > MAX_SESSION_JSON_BYTES
  ) {
    bounded = bounded.slice(1);
  }
  if (Buffer.byteLength(JSON.stringify(bounded), "utf8") > MAX_SESSION_JSON_BYTES) {
    throw new Error(
      `OpenAI tools session transcript exceeds ${MAX_SESSION_JSON_BYTES} bytes and cannot be persisted safely.`,
    );
  }
  return bounded;
}

export function persistOpenaiToolsSession(
  input: PersistOpenaiToolsSessionInput,
): OpenaiToolsSessionRecord {
  const now = new Date().toISOString();
  const id = input.existing?.id ?? createOpenaiToolsSessionId();
  const record: OpenaiToolsSessionRecord = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id,
    harness: "openai-tools",
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
    context: input.context,
    toolDeclarations: [...input.toolDeclarations].sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
    messages: boundedMessages(input.messages),
    ...(input.lastProviderMessageId !== undefined
      ? { lastProviderMessageId: input.lastProviderMessageId }
      : {}),
  };
  mkdirSync(sessionRoot(input.projectDir), { recursive: true });
  writeFileSync(sessionPath(input.projectDir, id), `${JSON.stringify(record, null, 2)}\n`);
  return {
    ...record,
    messages: cloneMessages(record.messages),
    toolDeclarations: [...record.toolDeclarations],
  };
}

export function snapshotOpenaiToolsSessionToolDeclarations(
  tools: readonly KotaTool[],
  mcpFingerprints: ReadonlyMap<string, string> | undefined,
): OpenaiToolsSessionToolDeclaration[] {
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

export function validateOpenaiToolsSessionContext(
  record: OpenaiToolsSessionRecord,
  current: OpenaiToolsSessionContext,
): void {
  const previous = record.context;
  if (previous.model !== current.model) {
    throw new Error(
      `OpenAI tools session "${record.id}" was created for model "${previous.model}", not "${current.model}".`,
    );
  }
  if (previous.providerName !== current.providerName) {
    throw new Error(
      `OpenAI tools session "${record.id}" was created for provider "${previous.providerName}", not "${current.providerName}".`,
    );
  }
  if (previous.outputMaxTokens !== current.outputMaxTokens) {
    throw new Error(
      `OpenAI tools session "${record.id}" output-token capability changed from ${previous.outputMaxTokens} to ${current.outputMaxTokens}.`,
    );
  }
  if (
    previous.providerSelection.provider !== current.providerSelection.provider ||
    previous.providerSelection.baseUrl !== current.providerSelection.baseUrl
  ) {
    throw new Error(
      `OpenAI tools session "${record.id}" provider selection changed and cannot be resumed safely.`,
    );
  }
  if (previous.cwd !== current.cwd) {
    throw new Error(
      `OpenAI tools session "${record.id}" was created in "${previous.cwd}", not "${current.cwd}".`,
    );
  }
  if (
    previous.scope.scopeId !== current.scope.scopeId ||
    previous.scope.projectId !== current.scope.projectId
  ) {
    if (previous.scope.scopeId !== undefined && current.scope.scopeId === undefined) {
      throw new Error(
        `OpenAI tools session "${record.id}" requires scope "${previous.scope.scopeId}", but the current run has no scope.`,
      );
    }
    throw new Error(
      `OpenAI tools session "${record.id}" scope changed and cannot be resumed safely.`,
    );
  }
}

export function validateOpenaiToolsSessionTools(
  record: OpenaiToolsSessionRecord,
  current: readonly OpenaiToolsSessionToolDeclaration[],
): void {
  const currentByName = new Map(current.map((entry) => [entry.name, entry]));
  for (const previous of record.toolDeclarations) {
    const next = currentByName.get(previous.name);
    if (next === undefined) {
      throw new Error(
        `OpenAI tools session "${record.id}" references unavailable tool "${previous.name}".`,
      );
    }
    if (next.source !== previous.source || next.fingerprint !== previous.fingerprint) {
      throw new Error(
        `OpenAI tools session "${record.id}" tool declaration for "${previous.name}" changed and cannot be resumed safely.`,
      );
    }
  }
}
