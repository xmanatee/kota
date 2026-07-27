import type { ToolSet } from "ai";
import type {
  KotaTool,
} from "#core/agent-harness/index.js";
import type { ToolCallInput } from "#core/tools/guardrails-classify.js";
import { getAllTools } from "#core/tools/index.js";
import {
  executeToolCalls,
  type ToolCallExecutionOptions,
  ToolPermissionInterruptedError,
} from "#core/tools/tool-runner.js";

export const VERCEL_ASK_OWNER_TOOL_NAME = "ask_owner";

type AiSdk = typeof import("ai");
type DynamicToolInput = Parameters<
  Parameters<AiSdk["dynamicTool"]>[0]["execute"]
>[0];

export type LoopFlags = {
  interrupted: boolean;
  interruptMessage: string;
};

function isPlainToolInput(value: DynamicToolInput): value is ToolCallInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function selectToolDefinitions(
  allowed: readonly string[] | undefined,
  disallowed: readonly string[] | undefined,
  includeAskOwner: boolean,
): KotaTool[] {
  const all = getAllTools();
  const denySet = new Set(disallowed ?? []);
  const allowSet = allowed && allowed.length > 0 ? new Set(allowed) : null;
  if (includeAskOwner && allowSet) allowSet.add(VERCEL_ASK_OWNER_TOOL_NAME);
  return all.filter((tool) => {
    if (denySet.has(tool.name)) return false;
    if (allowSet && !allowSet.has(tool.name)) return false;
    return true;
  });
}

export function buildVercelToolSet(
  ai: typeof import("ai"),
  kotaTools: readonly KotaTool[],
  executionOptions: ToolCallExecutionOptions,
  flags: LoopFlags,
  internalAbort: AbortController,
): ToolSet {
  const tools: ToolSet = {};

  for (const kotaTool of kotaTools) {
    tools[kotaTool.name] = ai.dynamicTool({
      description: kotaTool.description,
      inputSchema: ai.jsonSchema(
        kotaTool.input_schema as Parameters<typeof ai.jsonSchema>[0],
      ),
      execute: async (input, options) => {
        if (!isPlainToolInput(input)) {
          throw new Error(
            `vercel adapter: tool "${kotaTool.name}" received non-object input ` +
              `(${input === null ? "null" : Array.isArray(input) ? "array" : typeof input}); ` +
              "the SDK should validate against inputSchema before reaching execute.",
          );
        }

        try {
          const [result] = await executeToolCalls(
            [
              {
                type: "tool_use",
                id: options.toolCallId,
                name: kotaTool.name,
                input,
              },
            ],
            executionOptions,
          );
          if (!result) {
            throw new Error(
              `Vercel tool runner returned no result for "${kotaTool.name}".`,
            );
          }
          return {
            isError: result.is_error === true,
            content: result.content,
          };
        } catch (error) {
          if (!(error instanceof ToolPermissionInterruptedError)) throw error;
          flags.interrupted = true;
          flags.interruptMessage = error.result.content;
          internalAbort.abort(
            new Error(`canUseTool interrupted the loop: ${error.result.content}`),
          );
          return { isError: true, content: error.result.content };
        }
      },
    });
  }
  return tools;
}
