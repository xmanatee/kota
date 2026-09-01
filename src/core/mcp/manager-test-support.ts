import type { McpClientTransportConfig } from "./client.js";
import { MCP_CURRENT_PROTOCOL_VERSION } from "./client.js";
import { McpManager, type McpManagerOptions } from "./manager.js";
import type {
  McpManagerClient,
  McpManagerClientOptions,
} from "./manager-client-port.js";

const cache = { ttlMs: 0, cacheScope: "private" as const };

export type FakeMcpManagerClientCapabilities = {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  tasks?: boolean;
};

export class FakeMcpManagerClient implements McpManagerClient {
  connected = false;
  connectError?: Error;
  factoryOptions?: McpManagerClientOptions;
  tools: Awaited<ReturnType<McpManagerClient["listTools"]>> = [];
  listToolsCalls = 0;
  callToolCalls: Parameters<McpManagerClient["callTool"]>[] = [];
  getTaskCalls: string[] = [];
  updateTaskCalls: Parameters<McpManagerClient["updateTask"]>[] = [];
  cancelTaskCalls: string[] = [];
  listResourcesCalls = 0;
  listResourceTemplatesCalls = 0;
  listPromptsCalls = 0;
  closeCount = 0;

  callToolImpl: McpManagerClient["callTool"] = async () => ({
    resultType: "complete",
    protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
    content: [{ type: "text", text: "ok" }],
    text: "ok",
    blocks: [{ type: "text", text: "ok" }],
  });
  listToolsImpl: McpManagerClient["listTools"] = async () => this.tools;
  getTaskImpl: McpManagerClient["getTask"] = async (taskId) => ({
    taskId,
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUpdatedAt: "2026-01-01T00:00:01.000Z",
    ttlMs: null,
    result: {
      resultType: "complete",
      protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
      content: [{ type: "text", text: "done" }],
      text: "done",
      blocks: [{ type: "text", text: "done" }],
      structuredContent: { status: "done" },
    },
  });
  updateTaskImpl: McpManagerClient["updateTask"] = async () => ({ resultType: "complete" });
  cancelTaskImpl: McpManagerClient["cancelTask"] = async () => ({ resultType: "complete" });
  listResourcesImpl: McpManagerClient["listResources"] = async () => ({
    resources: [],
    cache,
  });
  listResourceTemplatesImpl: McpManagerClient["listResourceTemplates"] = async () => ({
    resourceTemplates: [],
    cache,
  });
  readResourceImpl: McpManagerClient["readResource"] = async () => ({
    resultType: "complete",
    protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
    contents: [],
    cache,
  });
  listRemoteSkillsImpl: McpManagerClient["listRemoteSkills"] = async () => ({
    status: "unavailable",
    indexUri: "skill://index.json",
    enumerationExhaustive: false,
    advertised: false,
    skills: [],
    reason: "not advertised",
  });
  readRemoteSkillImpl: McpManagerClient["readRemoteSkill"] = async (uri, source = "direct") => ({
    resultType: "complete",
    protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
    provenance: { server: this.name, uri, source, untrusted: true },
    contents: [],
    cache,
  });
  listPromptsImpl: McpManagerClient["listPrompts"] = async () => ({
    prompts: [],
    cache,
  });
  getPromptImpl: McpManagerClient["getPrompt"] = async () => ({
    resultType: "complete",
    protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
    messages: [],
  });

  private readonly toolListChangedHandlers = new Set<() => void>();
  private readonly resourceListChangedHandlers = new Set<() => void>();
  private readonly promptListChangedHandlers = new Set<() => void>();

  constructor(
    readonly name: string,
    readonly capabilities: FakeMcpManagerClientCapabilities = { tools: true },
  ) {}

  async connect(): Promise<void> {
    if (this.connectError) throw this.connectError;
    this.connected = true;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    this.connected = false;
  }

  isConnected(): boolean { return this.connected; }
  getName(): string { return this.name; }
  getCacheAuthorizationContextKey(): string { return `auth:${this.name}`; }
  supportsTools(): boolean { return this.capabilities.tools !== false; }
  supportsResources(): boolean { return this.capabilities.resources === true; }
  supportsPrompts(): boolean { return this.capabilities.prompts === true; }
  supportsTasks(): boolean { return this.capabilities.tasks === true; }

  onToolListChanged(handler: () => void): () => void {
    this.toolListChangedHandlers.add(handler);
    return () => this.toolListChangedHandlers.delete(handler);
  }

  onResourceListChanged(handler: () => void): () => void {
    this.resourceListChangedHandlers.add(handler);
    return () => this.resourceListChangedHandlers.delete(handler);
  }

  onPromptListChanged(handler: () => void): () => void {
    this.promptListChangedHandlers.add(handler);
    return () => this.promptListChangedHandlers.delete(handler);
  }

  emitToolListChanged(): void {
    for (const handler of this.toolListChangedHandlers) handler();
  }

  emitResourceListChanged(): void {
    for (const handler of this.resourceListChangedHandlers) handler();
  }

  emitPromptListChanged(): void {
    for (const handler of this.promptListChangedHandlers) handler();
  }

  async listTools(): Promise<Awaited<ReturnType<McpManagerClient["listTools"]>>> {
    this.listToolsCalls += 1;
    return this.listToolsImpl();
  }

  callTool(...args: Parameters<McpManagerClient["callTool"]>): ReturnType<McpManagerClient["callTool"]> {
    this.callToolCalls.push(args);
    return this.callToolImpl(...args);
  }

  getTask(taskId: string): ReturnType<McpManagerClient["getTask"]> {
    this.getTaskCalls.push(taskId);
    return this.getTaskImpl(taskId);
  }

  updateTask(...args: Parameters<McpManagerClient["updateTask"]>): ReturnType<McpManagerClient["updateTask"]> {
    this.updateTaskCalls.push(args);
    return this.updateTaskImpl(...args);
  }

  cancelTask(taskId: string): ReturnType<McpManagerClient["cancelTask"]> {
    this.cancelTaskCalls.push(taskId);
    return this.cancelTaskImpl(taskId);
  }

  listResources(): ReturnType<McpManagerClient["listResources"]> {
    this.listResourcesCalls += 1;
    return this.listResourcesImpl();
  }

  listResourceTemplates(): ReturnType<McpManagerClient["listResourceTemplates"]> {
    this.listResourceTemplatesCalls += 1;
    return this.listResourceTemplatesImpl();
  }

  readResource(...args: Parameters<McpManagerClient["readResource"]>): ReturnType<McpManagerClient["readResource"]> {
    return this.readResourceImpl(...args);
  }

  listRemoteSkills(): ReturnType<McpManagerClient["listRemoteSkills"]> {
    return this.listRemoteSkillsImpl();
  }

  readRemoteSkill(
    ...args: Parameters<McpManagerClient["readRemoteSkill"]>
  ): ReturnType<McpManagerClient["readRemoteSkill"]> {
    return this.readRemoteSkillImpl(...args);
  }

  listPrompts(): ReturnType<McpManagerClient["listPrompts"]> {
    this.listPromptsCalls += 1;
    return this.listPromptsImpl();
  }

  getPrompt(...args: Parameters<McpManagerClient["getPrompt"]>): ReturnType<McpManagerClient["getPrompt"]> {
    return this.getPromptImpl(...args);
  }
}

export type ManagerFactoryCall = {
  serverName: string;
  transport: McpClientTransportConfig;
  options: McpManagerClientOptions;
};

export function managerWithClients(
  clients: Record<string, FakeMcpManagerClient>,
  options: Omit<McpManagerOptions, "clientFactory"> = {},
): { manager: McpManager; factoryCalls: ManagerFactoryCall[] } {
  const factoryCalls: ManagerFactoryCall[] = [];
  const manager = new McpManager({
    ...options,
    clientFactory: (transport, serverName, clientOptions) => {
      const client = clients[serverName];
      if (!client) throw new Error(`No fake MCP client configured for ${serverName}`);
      client.factoryOptions = clientOptions;
      factoryCalls.push({ serverName, transport, options: clientOptions });
      return client;
    },
  });
  return { manager, factoryCalls };
}

export async function settleManagerRefresh(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
