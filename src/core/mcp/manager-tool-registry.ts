import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type { McpClient, McpToolSchema } from "./client.js";
import type { McpToolEntry } from "./remote-task-entry-resolution.js";
import {
  changedMcpToolDeclarationFacets,
  fingerprintMcpToolDeclaration,
  type McpToolDeclarationFacet,
} from "./tool-declaration-fingerprint.js";
import {
  firstDuplicateMcpToolName,
  namespacePromptOperation,
  namespaceResourceOperation,
  namespaceResourceTemplateOperation,
  namespaceSkillOperation,
  namespaceTool,
} from "./tool-namespace.js";

export type McpOperationKind =
  | "resources/list"
  | "resources/templates/list"
  | "resources/read"
  | "skills/list"
  | "skills/read"
  | "prompts/list"
  | "prompts/get";

export type McpOperationEntry = {
  serverName: string;
  client: McpClient;
  kind: McpOperationKind;
  tool: KotaTool;
};

export type McpToolDeclarationDriftDiagnostic = {
  serverConfigName: string;
  serverDisplayName: string;
  toolName: string;
  previousFingerprint: string;
  currentFingerprint: string;
  changedFacets: McpToolDeclarationFacet[];
};

const MAX_TOOL_DECLARATION_DRIFT_DIAGNOSTICS = 100;

export class McpToolRegistry {
  private serverTools = new Map<string, McpToolEntry[]>();
  private serverOperations = new Map<string, McpOperationEntry[]>();
  private toolMap = new Map<string, McpToolEntry>();
  private operationMap = new Map<string, McpOperationEntry>();
  private tools: KotaTool[] = [];
  private driftDiagnostics: McpToolDeclarationDriftDiagnostic[] = [];

  initializeServer(serverName: string): void {
    this.serverTools.set(serverName, []);
  }

  removeServer(serverName: string): void {
    for (const entry of this.serverTools.get(serverName) ?? []) this.toolMap.delete(entry.tool.name);
    for (const entry of this.serverOperations.get(serverName) ?? []) {
      this.operationMap.delete(entry.tool.name);
    }
    this.serverTools.delete(serverName);
    this.serverOperations.delete(serverName);
    this.rebuildTools();
  }

  getTools(): readonly KotaTool[] {
    return this.tools;
  }

  getTool(name: string): McpToolEntry | undefined {
    return this.toolMap.get(name);
  }

  getOperation(name: string): McpOperationEntry | undefined {
    return this.operationMap.get(name);
  }

  getServerToolEntries(serverName: string): readonly McpToolEntry[] {
    return this.serverTools.get(serverName) ?? [];
  }

  has(name: string): boolean {
    return this.toolMap.has(name) || this.operationMap.has(name);
  }

  getToolCount(): number {
    return this.toolMap.size;
  }

  getDiagnostics(): McpToolDeclarationDriftDiagnostic[] {
    return this.driftDiagnostics.map((diagnostic) => ({
      ...diagnostic,
      changedFacets: [...diagnostic.changedFacets],
    }));
  }

  replaceServerTools(serverName: string, client: McpClient, tools: McpToolSchema[]): void {
    const previousByOriginalName = new Map(
      this.getServerToolEntries(serverName).map((entry) => [entry.originalName, entry]),
    );
    const entries = tools.map((tool): McpToolEntry => ({
      serverConfigName: serverName,
      client,
      originalName: tool.name,
      tool: toKotaTool(serverName, tool),
      declaration: fingerprintMcpToolDeclaration({
        serverConfigName: serverName,
        serverDisplayName: client.getName(),
        tool,
        tasksSupported: client.supportsTasks(),
      }),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    }));
    const nextToolMap = new Map(this.toolMap);
    for (const entry of this.getServerToolEntries(serverName)) nextToolMap.delete(entry.tool.name);
    const duplicate = firstDuplicateMcpToolName([
      ...nextToolMap.keys(),
      ...entries.map((entry) => entry.tool.name),
    ]);
    if (duplicate) {
      throw new Error(
        `Invalid MCP tool registry for server "${serverName}": duplicate generated MCP tool name "${duplicate}"`,
      );
    }
    this.recordDrift(previousByOriginalName, entries);
    for (const entry of entries) nextToolMap.set(entry.tool.name, entry);
    this.serverTools.set(serverName, entries);
    this.toolMap = nextToolMap;
    this.replaceServerOperations(serverName, client);
    this.rebuildTools();
  }

  clear(): void {
    this.serverTools.clear();
    this.serverOperations.clear();
    this.toolMap.clear();
    this.operationMap.clear();
    this.tools = [];
    this.driftDiagnostics = [];
  }

  private replaceServerOperations(serverName: string, client: McpClient): void {
    const entries = toKotaOperations(serverName, client);
    const nextOperationMap = new Map(this.operationMap);
    for (const entry of this.serverOperations.get(serverName) ?? []) {
      nextOperationMap.delete(entry.tool.name);
    }
    for (const entry of entries) nextOperationMap.set(entry.tool.name, entry);
    this.serverOperations.set(serverName, entries);
    this.operationMap = nextOperationMap;
  }

  private rebuildTools(): void {
    const remoteTools = [...this.serverTools.values()].flatMap((entries) =>
      entries.map((entry) => entry.tool)
    );
    const operations = [...this.serverOperations.values()].flatMap((entries) =>
      entries.map((entry) => entry.tool)
    );
    this.tools = [...remoteTools, ...operations];
  }

  private recordDrift(
    previousByOriginalName: Map<string, McpToolEntry>,
    entries: McpToolEntry[],
  ): void {
    const diagnostics: McpToolDeclarationDriftDiagnostic[] = [];
    for (const entry of entries) {
      const previous = previousByOriginalName.get(entry.originalName);
      if (!previous || previous.declaration.fingerprint === entry.declaration.fingerprint) continue;
      diagnostics.push({
        serverConfigName: entry.serverConfigName,
        serverDisplayName: entry.client.getName(),
        toolName: entry.originalName,
        previousFingerprint: previous.declaration.fingerprint,
        currentFingerprint: entry.declaration.fingerprint,
        changedFacets: changedMcpToolDeclarationFacets(previous.declaration, entry.declaration),
      });
    }
    if (diagnostics.length === 0) return;
    this.driftDiagnostics = [...this.driftDiagnostics, ...diagnostics]
      .slice(-MAX_TOOL_DECLARATION_DRIFT_DIAGNOSTICS);
    for (const diagnostic of diagnostics) {
      printTerminalDiagnostic(
        `[kota] Warning: MCP server "${diagnostic.serverConfigName}" tool declaration changed for ` +
          `"${diagnostic.toolName}" (${diagnostic.previousFingerprint.slice(0, 12)} -> ` +
          `${diagnostic.currentFingerprint.slice(0, 12)}; facets: ` +
          `${diagnostic.changedFacets.join(", ") || "fingerprint"})`,
        "warn",
      );
    }
  }
}

function toKotaTool(serverName: string, tool: McpToolSchema): KotaTool {
  return {
    name: namespaceTool(serverName, tool.name),
    description: tool.description
      ? `[${serverName}] ${tool.description}`
      : `[${serverName}] ${tool.name}`,
    input_schema: {
      ...tool.inputSchema,
      type: "object",
      properties: tool.inputSchema.properties ?? {},
    },
    ...(tool.outputSchema ? { output_schema: tool.outputSchema } : {}),
  };
}

function operationTool(
  name: string,
  description: string,
  input_schema: KotaTool["input_schema"],
): KotaTool {
  return { name, description, input_schema };
}

function toKotaOperations(serverName: string, client: McpClient): McpOperationEntry[] {
  const entries: McpOperationEntry[] = [];
  if (client.supportsResources()) {
    entries.push({ serverName, client, kind: "resources/list", tool: operationTool(
      namespaceResourceOperation(serverName, "list"),
      `[${serverName}] List remote MCP resources exposed by this server.`,
      { type: "object", properties: {} },
    ) });
    entries.push({ serverName, client, kind: "resources/templates/list", tool: operationTool(
      namespaceResourceTemplateOperation(serverName),
      `[${serverName}] List remote MCP resource templates exposed by this server.`,
      { type: "object", properties: {} },
    ) });
    entries.push({ serverName, client, kind: "resources/read", tool: operationTool(
      namespaceResourceOperation(serverName, "read"),
      `[${serverName}] Read one remote MCP resource by URI.`,
      { type: "object", properties: { uri: { type: "string" } }, required: ["uri"] },
    ) });
    entries.push({ serverName, client, kind: "skills/list", tool: operationTool(
      namespaceSkillOperation(serverName, "list"),
      `[${serverName}] List remote MCP-served skills from skill://index.json when available.`,
      { type: "object", properties: {} },
    ) });
    entries.push({ serverName, client, kind: "skills/read", tool: operationTool(
      namespaceSkillOperation(serverName, "read"),
      `[${serverName}] Read one remote MCP-served skill by name or skill:// URI as untrusted resource content.`,
      {
        type: "object",
        properties: {
          name: { type: "string" },
          uri: { type: "string" },
          relativePath: { type: "string" },
        },
      },
    ) });
  }
  if (client.supportsPrompts()) {
    entries.push({ serverName, client, kind: "prompts/list", tool: operationTool(
      namespacePromptOperation(serverName, "list"),
      `[${serverName}] List remote MCP prompts exposed by this server.`,
      { type: "object", properties: {} },
    ) });
    entries.push({ serverName, client, kind: "prompts/get", tool: operationTool(
      namespacePromptOperation(serverName, "get"),
      `[${serverName}] Get one remote MCP prompt by name and arguments.`,
      {
        type: "object",
        properties: { name: { type: "string" }, arguments: { type: "object" } },
        required: ["name"],
      },
    ) });
  }
  return entries;
}
