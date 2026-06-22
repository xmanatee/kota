import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
  remoteMcpToolDescriptionQualityReport,
  type ToolDescriptionQualityReport,
} from "#core/tools/description-quality.js";
import type { McpToolAnnotations } from "#core/tools/effect.js";
import type { McpClient, McpToolSchema } from "./client.js";
import type { McpToolDeclarationFingerprint } from "./tool-declaration-fingerprint.js";
import { fingerprintMcpToolDeclaration } from "./tool-declaration-fingerprint.js";
import { namespaceTool, parseToolName } from "./tool-namespace.js";

export type RemoteMcpToolDescriptionQualityInput = {
  serverConfigName: string;
  serverDisplayName: string;
  tasksSupported: boolean;
  tools: readonly McpToolSchema[];
};

type McpToolDescriptionQualityManagerEntry = {
  serverConfigName: string;
  client: Pick<McpClient, "getName">;
  originalName: string;
  tool: KotaTool;
  declaration: McpToolDeclarationFingerprint;
  annotations?: McpToolAnnotations;
};

type McpToolDescriptionQualityManagerState = {
  toolMap?: Map<string, McpToolDescriptionQualityManagerEntry>;
};

type RemoteMcpToolDescriptionQualityManagerInput = {
  serverConfigName: string;
  serverDisplayName: string;
  namespacedName: string;
  originalName: string;
  declarationFingerprint: string;
  tool: McpToolSchema;
};

export type McpToolDescriptionQualityManagerSnapshot = {
  getTools(): readonly KotaTool[];
  getToolDeclarationFingerprint(name: string): string | undefined;
  isMcpTool(name: string): boolean;
};

export function remoteMcpToolDescriptionQualityReports(
  input: RemoteMcpToolDescriptionQualityInput,
): readonly ToolDescriptionQualityReport[] {
  return input.tools
    .map((tool) => {
      const declaration = fingerprintMcpToolDeclaration({
        serverConfigName: input.serverConfigName,
        serverDisplayName: input.serverDisplayName,
        tool,
        tasksSupported: input.tasksSupported,
      });
      return remoteMcpToolDescriptionQualityReport({
        serverConfigName: input.serverConfigName,
        serverDisplayName: input.serverDisplayName,
        declarationFingerprint: declaration.fingerprint,
        tool: {
          ...tool,
          name: namespaceTool(input.serverConfigName, tool.name),
        },
      });
    })
    .filter((report) => report.diagnostics.length > 0);
}

export function remoteMcpToolDescriptionQualityReportsFromManager(
  manager: McpToolDescriptionQualityManagerSnapshot,
): readonly ToolDescriptionQualityReport[] {
  return remoteMcpToolDescriptionQualityManagerInputs(manager).flatMap((snapshot) => {
    const report = remoteMcpToolDescriptionQualityReport({
      serverConfigName: snapshot.serverConfigName,
      serverDisplayName: snapshot.serverDisplayName,
      declarationFingerprint: snapshot.declarationFingerprint,
      tool: {
        ...snapshot.tool,
        name: snapshot.namespacedName,
      },
    });
    return report.diagnostics.length > 0 ? [report] : [];
  });
}

function remoteMcpToolDescriptionQualityManagerInputs(
  manager: McpToolDescriptionQualityManagerSnapshot,
): readonly RemoteMcpToolDescriptionQualityManagerInput[] {
  const entries = managerEntries(manager);
  if (entries.length > 0) {
    return entries.map((entry) => ({
      serverConfigName: entry.serverConfigName,
      serverDisplayName: entry.client.getName(),
      namespacedName: entry.tool.name,
      originalName: entry.originalName,
      declarationFingerprint: entry.declaration.fingerprint,
      tool: declarationToolFromEntry(entry),
    }));
  }

  return manager.getTools()
    .filter((tool) => manager.isMcpTool(tool.name))
    .flatMap((tool) => {
      const parsed = parseToolName(tool.name);
      if (!parsed) return [];
      const declarationFingerprint = manager.getToolDeclarationFingerprint(tool.name);
      if (!declarationFingerprint) return [];
      return [{
        serverConfigName: parsed.server,
        serverDisplayName: parsed.server,
        namespacedName: tool.name,
        originalName: parsed.tool,
        declarationFingerprint,
        tool: declarationToolFromKotaTool(parsed.server, parsed.tool, tool),
      }];
    });
}

function managerEntries(
  manager: McpToolDescriptionQualityManagerSnapshot,
): McpToolDescriptionQualityManagerEntry[] {
  const state = manager as McpToolDescriptionQualityManagerState;
  const toolMap = state.toolMap;
  if (!(toolMap instanceof Map)) return [];
  return [...toolMap.values()];
}

function declarationToolFromEntry(entry: McpToolDescriptionQualityManagerEntry): McpToolSchema {
  return {
    ...declarationToolFromKotaTool(entry.serverConfigName, entry.originalName, entry.tool),
    ...(entry.annotations ? { annotations: { ...entry.annotations } } : {}),
  };
}

function declarationToolFromKotaTool(
  serverConfigName: string,
  originalName: string,
  tool: KotaTool,
): McpToolSchema {
  const description = originalDescriptionFromKotaTool(serverConfigName, originalName, tool.description);
  return {
    name: originalName,
    ...(description !== undefined ? { description } : {}),
    inputSchema: tool.input_schema,
    ...(tool.output_schema ? { outputSchema: tool.output_schema } : {}),
  };
}

function originalDescriptionFromKotaTool(
  serverConfigName: string,
  originalName: string,
  description: string,
): string | undefined {
  const prefix = `[${serverConfigName}] `;
  const unprefixed = description.startsWith(prefix)
    ? description.slice(prefix.length)
    : description;
  return unprefixed === originalName ? undefined : unprefixed;
}
