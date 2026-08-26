import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/index.js";
import { validateToolStructuredOutput } from "#core/tools/output-schema.js";
import type {
  McpCallToolResult,
  McpInputRequiredCallToolResult,
  McpInputRequiredResult,
} from "./client.js";
import type { McpToolEntry } from "./remote-task-entry-resolution.js";

function inputRequiredDiagnostics(
  entry: McpToolEntry,
  result: McpInputRequiredCallToolResult,
): KotaJsonObject {
  return {
    resultType: "input_required",
    protocolVersion: result.protocolVersion,
    server: entry.client.getName(),
    tool: entry.originalName,
    ...(result.inputRequests ? { inputRequests: result.inputRequests } : {}),
    ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
    ...(result._meta ? { resultMeta: result._meta } : {}),
  };
}

function hasSamplingInputRequest(result: McpInputRequiredResult): boolean {
  return Object.values(result.inputRequests ?? {}).some(
    (request) => request.method === "sampling/createMessage",
  );
}

function inputRequiredUnavailableDetail(result: McpInputRequiredResult): string {
  if (hasSamplingInputRequest(result)) {
    return " the remote server requested sampling/createMessage, but no operator-approved sampling bridge is configured.";
  }
  return " this KOTA runtime cannot route remote input_required results yet.";
}

export function unsupportedInputRequiredResult(
  entry: McpToolEntry,
  result: McpInputRequiredCallToolResult,
  reason?: string,
): ToolResult {
  const detail = reason
    ? ` ${reason}`
    : inputRequiredUnavailableDetail(result);
  return {
    content:
      `MCP tool error: remote MCP tool "${entry.originalName}" on server ` +
      `"${entry.client.getName()}" requires additional input, but${detail}`,
    is_error: true,
    _meta: { mcp: inputRequiredDiagnostics(entry, result) },
  };
}

export function toToolResult(
  entry: McpToolEntry,
  result: McpCallToolResult,
): ToolResult {
  if (result.resultType === "task") {
    return {
      content:
        `MCP tool error: remote MCP task "${result.taskId}" for tool ` +
        `"${entry.originalName}" was not resolved by the manager`,
      is_error: true,
      _meta: {
        mcpTask: {
          resultType: "task",
          protocolVersion: result.protocolVersion,
          server: entry.client.getName(),
          tool: entry.originalName,
          taskId: result.taskId,
          status: result.status,
        },
      },
    };
  }
  if (result.resultType === "input_required") {
    return unsupportedInputRequiredResult(
      entry,
      result,
      "the remote server requested additional input again after the retry.",
    );
  }
  const toolResult: ToolResult = {
    content: result.text,
    blocks: result.blocks,
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    ...(result._meta ? { _meta: result._meta } : {}),
    ...(result.isError !== undefined ? { is_error: result.isError } : {}),
  };
  const schemaError = validateToolStructuredOutput(entry.tool, toolResult);
  if (schemaError) {
    return { content: `MCP tool error: ${schemaError}`, is_error: true };
  }
  return toolResult;
}
