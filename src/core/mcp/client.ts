import type {
  McpClientOptions,
  McpClientTransportConfig,
} from "./client-auth-types.js";
import { McpClientOperations } from "./client-operations.js";

export type {
  McpAuthorizationChallenge,
  McpAuthorizationResolver,
  McpAuthorizationResolverRequest,
  McpAuthorizationResolverResult,
  McpClientOptions,
  McpClientTransportConfig,
  McpOAuthAuthorizationCodeConfig,
  McpOAuthClientCredentialsAuthorizationConfig,
  McpOAuthClientCredentialsClientConfig,
  McpOAuthClientCredentialsClientSecretBasicClientConfig,
  McpOAuthClientCredentialsPrivateKeyJwtClientConfig,
  McpOAuthClientCredentialsPrivateKeyJwtSigningAlgorithm,
  McpOAuthClientCredentialsTokenEndpointAuthMethod,
  McpOAuthClientIdentityConfig,
  McpOAuthClientIdMetadataUrlConfig,
  McpOAuthDynamicClientConfig,
  McpOAuthRegisteredClientConfig,
  McpProtectedResourceMetadata,
  McpProtectedResourceMetadataDiscovery,
  McpStdioClientTransportConfig,
  McpStreamableHttpAuthorizationConfig,
  McpStreamableHttpClientTransportConfig,
} from "./client-auth-types.js";
export {
  McpAuthorizationError,
  McpAuthorizationFlowError,
  McpConnectionError,
  McpOAuthSecret,
  McpToolError,
  mcpOAuthSecret,
} from "./client-auth-types.js";
export {
  mcpToolInputRequestElicitationMode,
  mcpToolUrlElicitationDetails,
} from "./client-input-helpers.js";
export type {
  McpCacheHints,
  McpCacheScope,
  McpCallToolOptions,
  McpCallToolResult,
  McpCallToolRetry,
  McpCompleteCallToolResult,
  McpElicitationInputRequest,
  McpElicitationMode,
  McpGetPromptCompleteResult,
  McpGetPromptResult,
  McpInputRequiredCallToolResult,
  McpInputRequiredResult,
  McpLegacyCallToolResult,
  McpListPromptsPage,
  McpListResourcesPage,
  McpListResourceTemplatesPage,
  McpListToolsPage,
  McpLogLevel,
  McpLogMessageEvent,
  McpLogMessageHandler,
  McpOperationRetry,
  McpProgressEvent,
  McpProgressHandler,
  McpProgressToken,
  McpPromptArgumentSchema,
  McpPromptMessage,
  McpPromptSchema,
  McpProtocolVersion,
  McpReadResourceCompleteResult,
  McpReadResourceResult,
  McpRequestProgressOptions,
  McpResourceListChangedHandler,
  McpResourceSchema,
  McpResourceTemplateSchema,
  McpSamplingAudioContent,
  McpSamplingContentBlock,
  McpSamplingCreateMessageParams,
  McpSamplingCreateMessageResult,
  McpSamplingInputRequest,
  McpSamplingMessage,
  McpSamplingModelPreferences,
  McpSamplingTool,
  McpSamplingToolChoice,
  McpSamplingToolResultContent,
  McpSamplingToolUseContent,
  McpToolArguments,
  McpToolContentBlock,
  McpToolImageContent,
  McpToolInputRequest,
  McpToolInputRequests,
  McpToolInputResponse,
  McpToolInputResponses,
  McpToolListChangedHandler,
  McpToolResultContract,
  McpToolSchema,
  McpToolTextContent,
} from "./client-protocol.js";
export {
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
} from "./client-protocol.js";
export { decodeMcpToolInputResponses } from "./client-result-decoders.js";

/**
 * Lightweight MCP client using JSON-RPC 2.0 over stdio or Streamable HTTP.
 * Handles the MCP lifecycle: initialize -> list tools -> call tools -> close.
 */
export class McpClient extends McpClientOperations {
  constructor(
    command: string,
    args?: string[],
    env?: Record<string, string>,
    name?: string,
    options?: McpClientOptions,
  );
  constructor(
    transport: McpClientTransportConfig,
    name?: string,
    options?: McpClientOptions,
  );
  constructor(
    commandOrTransport: string | McpClientTransportConfig,
    argsOrName: string[] | string = [],
    envOrOptions: Record<string, string> | McpClientOptions = {},
    name?: string,
    options: McpClientOptions = {},
  ) {
    super(commandOrTransport, argsOrName, envOrOptions, name, options);
  }
}
