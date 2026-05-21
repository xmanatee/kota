import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { runAskUser } from "#core/tools/ask-user.js";
import {
  decodeMcpToolInputResponses,
  type McpToolInputResponses,
  mcpToolUrlElicitationDetails,
} from "./client.js";
import type {
  McpInputResolver,
  McpInputResolverResult,
  McpRemoteInputRequest,
} from "./manager.js";

function formatInputRequests(request: McpRemoteInputRequest): string {
  return JSON.stringify(request.inputRequests, null, 2);
}

function formatUrlModeRequests(request: McpRemoteInputRequest): string {
  const lines: string[] = [];
  for (const [requestId, inputRequest] of Object.entries(request.inputRequests)) {
    const details = mcpToolUrlElicitationDetails(inputRequest);
    if (!details) continue;
    lines.push(
      `- ${requestId}: server="${request.server}", tool="${request.tool}", ` +
        `message="${details.message}", url="${details.url}", ` +
        `elicitationId="${details.elicitationId}"`,
    );
  }
  return lines.join("\n");
}

export function buildMcpInputResponseQuestion(request: McpRemoteInputRequest): string {
  const urlModeRequests = formatUrlModeRequests(request);
  const urlModeSection = urlModeRequests
    ? `URL-mode requests:\n${urlModeRequests}\nDo not paste credentials or URL output into the response.\n\n`
    : "";
  return (
    `Remote MCP tool "${request.tool}" on server "${request.server}" requires additional input.\n\n` +
    `Input requests:\n${formatInputRequests(request)}\n\n` +
    urlModeSection +
    "Reply with a JSON object named by request id using MCP input response objects. " +
    'For form mode, accept requires content: {"request_id":{"action":"accept","content":{}}}. ' +
    'For URL mode, accept only with explicit consent: {"request_id":{"action":"accept"}}. ' +
    'Use action "decline" for explicit refusal or "cancel" for dismissal.'
  );
}

function parseOperatorInputResponses(
  answer: string,
  request: McpRemoteInputRequest,
): McpToolInputResponses {
  const parsed = JSON.parse(answer) as KotaJsonValue;
  return decodeMcpToolInputResponses(parsed, request.inputRequests);
}

export function createAskUserMcpInputResolver(): McpInputResolver {
  return async (request): Promise<McpInputResolverResult> => {
    const answer = await runAskUser({
      question: buildMcpInputResponseQuestion(request),
    });
    try {
      return {
        kind: "respond",
        inputResponses: parseOperatorInputResponses(answer.content, request),
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
