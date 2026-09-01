import {
  McpClient,
  type McpClientOptions,
  type McpClientTransportConfig,
} from "./client.js";

/** The protocol-client surface consumed by manager-owned composition and routing. */
export type McpManagerClient = Pick<
  McpClient,
  | "connect"
  | "close"
  | "isConnected"
  | "getName"
  | "getCacheAuthorizationContextKey"
  | "supportsTools"
  | "supportsResources"
  | "supportsPrompts"
  | "supportsTasks"
  | "onToolListChanged"
  | "onResourceListChanged"
  | "onPromptListChanged"
  | "listTools"
  | "callTool"
  | "listResources"
  | "listResourceTemplates"
  | "readResource"
  | "listRemoteSkills"
  | "readRemoteSkill"
  | "listPrompts"
  | "getPrompt"
  | "getTask"
  | "updateTask"
  | "cancelTask"
>;

export type McpManagerClientOptions = Pick<
  McpClientOptions,
  "supportedElicitationModes" | "enableRemoteTasks" | "authorizationResolver"
>;

export type McpManagerClientFactory = (
  transport: McpClientTransportConfig,
  serverName: string,
  options: McpManagerClientOptions,
) => McpManagerClient;

export const createMcpManagerClient: McpManagerClientFactory = (
  transport,
  serverName,
  options,
) => new McpClient(transport, serverName, options);
