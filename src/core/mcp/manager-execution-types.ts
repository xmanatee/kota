import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type {
  McpProgressEvent,
  McpToolInputRequests,
  McpToolInputResponses,
} from "./client.js";

export type McpRemoteInputRequest = {
  server: string;
  tool: string;
  inputRequests: McpToolInputRequests;
  requestState?: string;
  resultMeta?: KotaJsonObject;
};

export type McpInputResolverResult =
  | { kind: "respond"; inputResponses: McpToolInputResponses }
  | { kind: "unavailable"; reason: string };

export type McpInputResolver = (
  request: McpRemoteInputRequest,
) => Promise<McpInputResolverResult>;

export type McpRemoteProgressEvent = McpProgressEvent & {
  server: string;
  tool: string;
};

export type McpProgressResolver = (event: McpRemoteProgressEvent) => void;

export type McpExecuteToolOptions = {
  inputResolver?: McpInputResolver;
  progressResolver?: McpProgressResolver;
  maxProgressEvents?: number;
  signal?: AbortSignal;
};
