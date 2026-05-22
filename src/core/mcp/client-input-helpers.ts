import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type {
  McpElicitationMode,
  McpSamplingInputRequest,
  McpToolInputRequest,
} from "./client-protocol.js";

export function mcpToolInputRequestElicitationMode(
  request: McpToolInputRequest | McpSamplingInputRequest,
): McpElicitationMode | null {
  if (request.method !== "elicitation/create") return null;
  return request.params.mode === "url" ? "url" : "form";
}

export function mcpToolUrlElicitationDetails(
  request: McpToolInputRequest | McpSamplingInputRequest,
): { message: string; url: string; elicitationId: string } | null {
  if (mcpToolInputRequestElicitationMode(request) !== "url") return null;
  const params = request.params as KotaJsonObject;
  const { message, url, elicitationId } = params;
  if (
    typeof message !== "string" ||
    typeof url !== "string" ||
    typeof elicitationId !== "string"
  ) {
    return null;
  }
  return { message, url, elicitationId };
}

export function uniqueSupportedElicitationModes(
  modes: readonly McpElicitationMode[] | undefined,
): readonly McpElicitationMode[] {
  if (!modes) return [];
  const supported = new Set<McpElicitationMode>();
  for (const mode of modes) {
    if (mode !== "form" && mode !== "url") {
      throw new Error(`Unsupported MCP elicitation mode: ${String(mode)}`);
    }
    supported.add(mode);
  }
  return [...supported];
}
