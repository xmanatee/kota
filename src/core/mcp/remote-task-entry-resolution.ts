import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { McpToolAnnotations } from "#core/tools/effect.js";
import type { McpManagerClient } from "./manager-client-port.js";
import type { PersistedRemoteMcpTaskHandle } from "./remote-task-store.js";
import type { McpToolDeclarationFingerprint } from "./tool-declaration-fingerprint.js";
import { namespaceTool } from "./tool-namespace.js";

export type McpToolEntry = {
  serverConfigName: string;
  client: McpManagerClient;
  originalName: string;
  tool: KotaTool;
  declaration: McpToolDeclarationFingerprint;
  annotations?: McpToolAnnotations;
};

type McpPersistedRemoteTaskEntryResolution =
  | { kind: "entry"; entry: McpToolEntry }
  | { kind: "diagnostic"; message: string };

type EntryForPersistedRemoteTaskInput = {
  handle: PersistedRemoteMcpTaskHandle;
  client: McpManagerClient;
  entries: readonly McpToolEntry[] | undefined;
};

function operationTool(
  name: string,
  description: string,
  input_schema: KotaTool["input_schema"],
): KotaTool {
  return {
    name,
    description,
    input_schema,
  };
}

export function entryForPersistedRemoteTask(
  input: EntryForPersistedRemoteTaskInput,
): McpPersistedRemoteTaskEntryResolution {
  const { handle } = input;
  const currentEntry = input.entries?.find((entry) => entry.originalName === handle.toolName);
  if (currentEntry) {
    if (
      handle.toolDeclarationFingerprint !== undefined &&
      handle.toolDeclarationFingerprint !== currentEntry.declaration.fingerprint
    ) {
      return {
        kind: "diagnostic",
        message: remoteTaskToolDeclarationDriftMessage(
          handle,
          currentEntry.declaration.fingerprint,
        ),
      };
    }
    return { kind: "entry", entry: currentEntry };
  }
  if (handle.toolDeclarationFingerprint !== undefined) {
    return {
      kind: "diagnostic",
      message: missingRemoteTaskToolDeclarationMessage(handle),
    };
  }
  const declarationFingerprint = handle.toolDeclarationFingerprint ?? handle.serverFingerprint;
  return {
    kind: "entry",
    entry: {
      serverConfigName: handle.serverConfigName,
      client: input.client,
      originalName: handle.toolName,
      tool: operationTool(
        namespaceTool(handle.serverConfigName, handle.toolName),
        `[${handle.serverConfigName}] Resumed remote MCP task for ${handle.toolName}.`,
        { type: "object", properties: {} },
      ),
      declaration: {
        fingerprint: declarationFingerprint,
        facetFingerprints: {
          serverIdentity: declarationFingerprint,
          description: declarationFingerprint,
          inputSchema: declarationFingerprint,
          outputSchema: declarationFingerprint,
          annotations: declarationFingerprint,
          capabilities: declarationFingerprint,
        },
      },
    },
  };
}

export function remoteTaskToolDeclarationDriftMessage(
  handle: PersistedRemoteMcpTaskHandle,
  currentFingerprint: string,
): string {
  return (
    `tool declaration fingerprint for "${handle.toolName}" changed since remote task ` +
    `"${handle.taskId}" was created; persisted toolDeclarationFingerprint=` +
    `${handle.toolDeclarationFingerprint}; current toolDeclarationFingerprint=` +
    `${currentFingerprint}; remote task was not resumed because its result would be ` +
    "validated against a different declaration"
  );
}

export function missingRemoteTaskToolDeclarationMessage(
  handle: PersistedRemoteMcpTaskHandle,
): string {
  return (
    `current tool declaration is missing for "${handle.toolName}"; persisted ` +
    `toolDeclarationFingerprint=${handle.toolDeclarationFingerprint}; remote task ` +
    `"${handle.taskId}" was not resumed because its result cannot be validated ` +
    "against the original declaration"
  );
}
