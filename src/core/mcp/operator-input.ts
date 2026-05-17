import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { runAskUser } from "#core/tools/ask-user.js";
import {
  decodeMcpToolInputResponses,
  type McpToolInputResponses,
} from "./client.js";
import type {
  McpInputResolver,
  McpInputResolverResult,
  McpRemoteInputRequest,
} from "./manager.js";

function formatInputRequests(request: McpRemoteInputRequest): string {
  return JSON.stringify(request.inputRequests, null, 2);
}

export function buildMcpInputResponseQuestion(request: McpRemoteInputRequest): string {
  return (
    `Remote MCP tool "${request.tool}" on server "${request.server}" requires additional input.\n\n` +
    `Input requests:\n${formatInputRequests(request)}\n\n` +
    "Reply with a JSON object named by request id using MCP input response objects. " +
    'Example: {"request_id":{"action":"accept","content":{}}}. ' +
    'Use action "reject" or "cancel" to decline.'
  );
}

function parseOperatorInputResponses(answer: string): McpToolInputResponses {
  const parsed = JSON.parse(answer) as KotaJsonValue;
  return decodeMcpToolInputResponses(parsed);
}

export function createAskUserMcpInputResolver(): McpInputResolver {
  return async (request): Promise<McpInputResolverResult> => {
    const answer = await runAskUser({
      question: buildMcpInputResponseQuestion(request),
    });
    try {
      return {
        kind: "respond",
        inputResponses: parseOperatorInputResponses(answer.content),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        kind: "unavailable",
        reason: `operator input did not produce valid MCP inputResponses: ${message}`,
      };
    }
  };
}
