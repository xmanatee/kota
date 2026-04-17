import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import { askOwnerTool, runAskOwner } from "#core/tools/ask-owner.js";

export const KOTA_OWNER_QUESTIONS_MCP_SERVER = "kota_owner_questions";
export const KOTA_OWNER_QUESTIONS_MCP_TOOL =
  `mcp__${KOTA_OWNER_QUESTIONS_MCP_SERVER}__ask_owner`;

const askOwnerInputSchema = {
  context: z
    .string()
    .min(1)
    .describe("Brief background: what you are working on and the decision point you reached."),
  question: z
    .string()
    .min(1)
    .describe("A single concrete question ending with `?`."),
  reason: z
    .string()
    .min(1)
    .describe("Why owner input is required rather than proceeding on best judgment."),
  proposed_answers: z
    .array(z.string().min(1))
    .max(6)
    .optional()
    .describe("Optional short list of concrete options the owner can pick from."),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("How long to wait for an answer before returning. Default 600."),
};

export function createOwnerQuestionMcpServers(
  source: string,
): Record<string, McpServerConfig> {
  return {
    [KOTA_OWNER_QUESTIONS_MCP_SERVER]: createSdkMcpServer({
      name: KOTA_OWNER_QUESTIONS_MCP_SERVER,
      version: "1.0.0",
      tools: [
        tool(
          "ask_owner",
          askOwnerTool.description ?? "Escalate a high-stakes decision to the repo owner.",
          askOwnerInputSchema,
          async (args) => {
            const result = await runAskOwner(args, { source: () => source });
            return {
              content: [{ type: "text", text: result.content }],
              ...(result.is_error ? { isError: true } : {}),
            };
          },
          { alwaysLoad: true },
        ),
      ],
    }),
  };
}
