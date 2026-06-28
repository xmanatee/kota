import type { ToolSet } from "ai";
import type {
  AgentCanUseTool,
  AgentHarnessRunOptions,
  KotaTool,
} from "#core/agent-harness/index.js";
import type { ToolCallInput } from "#core/tools/guardrails-classify.js";
import { executeTool, getAllTools } from "#core/tools/index.js";
import { maskToolResultSecrets } from "#core/tools/secret-masking.js";

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
  guardrails: {
    canUseTool: AgentCanUseTool | undefined;
    abortSignal: AbortSignal | undefined;
    workflowContext: AgentHarnessRunOptions["workflowContext"];
    tokenBudget: AgentHarnessRunOptions["tokenBudget"];
    cwd: AgentHarnessRunOptions["cwd"];
    env: AgentHarnessRunOptions["env"];
  },
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

        let effectiveInput: ToolCallInput = input;
        if (guardrails.canUseTool) {
          const toolAbort = new AbortController();
          if (guardrails.abortSignal) {
            if (guardrails.abortSignal.aborted) {
              toolAbort.abort(guardrails.abortSignal.reason);
            } else {
              guardrails.abortSignal.addEventListener(
                "abort",
                () => toolAbort.abort(guardrails.abortSignal?.reason),
                { once: true },
              );
            }
          }
          const decision = await guardrails.canUseTool(kotaTool.name, input, {
            signal: toolAbort.signal,
            suggestions: [],
            toolUseId: options.toolCallId,
          });
          if (decision.behavior === "deny") {
            if (decision.interrupt === true) {
              flags.interrupted = true;
              flags.interruptMessage = decision.message;
              internalAbort.abort(
                new Error(`canUseTool interrupted the loop: ${decision.message}`),
              );
              return { isError: true, content: decision.message };
            }
            return { isError: true, content: decision.message };
          }
          if (
            decision.behavior === "allow" &&
            isPlainToolInput(decision.updatedInput)
          ) {
            effectiveInput = decision.updatedInput;
          }
        }

        const result = maskToolResultSecrets(await executeTool(kotaTool.name, effectiveInput, {
          toolUseId: options.toolCallId,
          ...(guardrails.cwd !== undefined ? { cwd: guardrails.cwd } : {}),
          ...(guardrails.env !== undefined ? { env: guardrails.env } : {}),
          ...(guardrails.abortSignal !== undefined ? { signal: guardrails.abortSignal } : {}),
          ...(guardrails.workflowContext !== undefined
            ? {
                workflow: guardrails.workflowContext,
                scopeId: guardrails.workflowContext.scopeId,
                projectId: guardrails.workflowContext.projectId,
              }
            : {}),
          ...(guardrails.tokenBudget !== undefined ? { tokenBudget: guardrails.tokenBudget } : {}),
        }));
        return {
          isError: result.is_error === true,
          content: result.content,
        };
      },
    });
  }
  return tools;
}
