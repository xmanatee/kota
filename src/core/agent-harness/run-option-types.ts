type AgentOpaque = unknown;

export type AgentDecisionAttribution =
  | "operator-allow-once"
  | "operator-allow-always"
  | "operator-deny";

export type AgentPermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, AgentOpaque>;
      updatedPermissions?: AgentOpaque[];
      toolUseId?: string;
      decisionAttribution?: AgentDecisionAttribution;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseId?: string;
      decisionAttribution?: AgentDecisionAttribution;
    };

export type AgentCanUseToolContext = {
  signal: AbortSignal;
  suggestions?: AgentOpaque[];
  blockedPath?: string;
  decisionReason?: string;
  title?: string;
  displayName?: string;
  description?: string;
  toolUseId: string;
  agentId?: string;
};

export type AgentCanUseTool = (
  toolName: string,
  input: Record<string, AgentOpaque>,
  context: AgentCanUseToolContext,
) => Promise<AgentPermissionResult>;

export type AgentMcpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type AgentMcpSseServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  tools?: AgentOpaque[];
};

export type AgentMcpHttpServerConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  tools?: AgentOpaque[];
};

export type AgentMcpServerConfig =
  | AgentMcpStdioServerConfig
  | AgentMcpSseServerConfig
  | AgentMcpHttpServerConfig;

export type AgentMcpServers = Record<string, AgentMcpServerConfig>;

export type AgentAskOwnerOptions = {
  source: string;
};
