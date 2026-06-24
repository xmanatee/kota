import type {
  AgentCanUseTool,
  AgentHarnessRunOptions,
  KotaContentBlock,
  KotaTextBlock,
  KotaTool,
  KotaToolResultBlock,
  KotaToolUseBlock,
} from "#core/agent-harness/index.js";
import { executeTool, getAllTools } from "#core/tools/index.js";
import { maskToolResultSecrets } from "#core/tools/secret-masking.js";
import { OPENAI_TOOLS_ASK_OWNER_TOOL_NAME } from "./constants.js";

type ToolInput = Parameters<AgentCanUseTool>[1];

export function isToolUseBlock(block: KotaContentBlock): block is KotaToolUseBlock {
  return block.type === "tool_use";
}

export function isTextBlock(block: KotaContentBlock): block is KotaTextBlock {
  return block.type === "text";
}

function isPlainToolInput(
  value: KotaToolUseBlock["input"] | ToolInput | undefined,
): value is ToolInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeRawFallback(input: KotaToolUseBlock["input"]): boolean {
  if (!isPlainToolInput(input)) return false;
  const keys = Object.keys(input);
  return (
    keys.length === 1 &&
    keys[0] === "_raw" &&
    typeof Reflect.get(input, "_raw") === "string"
  );
}

function validateToolUseBlock(call: KotaToolUseBlock): ToolInput {
  if (typeof call.name !== "string" || call.name.length === 0) {
    throw new Error(
      `OpenAI model returned a malformed tool_call: missing tool name (id=${String(call.id)}).`,
    );
  }
  if (looksLikeRawFallback(call.input)) {
    throw new Error(
      `OpenAI model returned malformed JSON arguments for tool "${call.name}" ` +
        "(non-parseable JSON in tool_call.function.arguments).",
    );
  }
  if (!isPlainToolInput(call.input)) {
    throw new Error(
      `OpenAI model returned a malformed tool_call for "${call.name}": input must be a JSON object, got ${
        call.input === null
          ? "null"
          : Array.isArray(call.input)
            ? "array"
            : typeof call.input
      }.`,
    );
  }
  return call.input;
}

export function selectToolDefinitions(
  allowed: readonly string[] | undefined,
  disallowed: readonly string[] | undefined,
  includeAskOwner: boolean,
): KotaTool[] {
  const all = getAllTools();
  const denySet = new Set(disallowed ?? []);
  const allowSet = allowed && allowed.length > 0 ? new Set(allowed) : null;
  if (includeAskOwner && allowSet) {
    allowSet.add(OPENAI_TOOLS_ASK_OWNER_TOOL_NAME);
  }
  return all.filter((tool) => {
    if (denySet.has(tool.name)) return false;
    if (allowSet && !allowSet.has(tool.name)) return false;
    return true;
  });
}

export type DenialOutcome = {
  block: KotaToolResultBlock;
  interrupt: boolean;
  message: string;
};

type DispatchToolCallResult = {
  result: KotaToolResultBlock;
  denial?: DenialOutcome;
};

export async function dispatchToolCall(
  call: KotaToolUseBlock,
  options: {
    canUseTool: AgentCanUseTool | undefined;
    allowedTools: readonly string[] | undefined;
    disallowedTools: readonly string[] | undefined;
    abortSignal: AbortSignal | undefined;
    workflowContext: AgentHarnessRunOptions["workflowContext"];
    tokenBudget: AgentHarnessRunOptions["tokenBudget"];
    cwd: AgentHarnessRunOptions["cwd"];
  },
): Promise<DispatchToolCallResult> {
  const validatedInput = validateToolUseBlock(call);

  const denySet = new Set(options.disallowedTools ?? []);
  if (denySet.has(call.name)) {
    const denial: DenialOutcome = {
      block: {
        type: "tool_result",
        tool_use_id: call.id,
        content: `Tool "${call.name}" is in disallowedTools and cannot run.`,
        is_error: true,
      },
      interrupt: false,
      message: `disallowedTools blocked ${call.name}`,
    };
    return { result: denial.block, denial };
  }

  if (
    options.allowedTools &&
    options.allowedTools.length > 0 &&
    !options.allowedTools.includes(call.name)
  ) {
    const denial: DenialOutcome = {
      block: {
        type: "tool_result",
        tool_use_id: call.id,
        content: `Tool "${call.name}" is not in allowedTools and cannot run.`,
        is_error: true,
      },
      interrupt: false,
      message: `allowedTools excluded ${call.name}`,
    };
    return { result: denial.block, denial };
  }

  let effectiveInput: ToolInput = validatedInput;
  if (options.canUseTool) {
    const abortController = new AbortController();
    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        abortController.abort(options.abortSignal.reason);
      } else {
        options.abortSignal.addEventListener(
          "abort",
          () => abortController.abort(options.abortSignal?.reason),
          { once: true },
        );
      }
    }
    const decision = await options.canUseTool(call.name, validatedInput, {
      signal: abortController.signal,
      suggestions: [],
      toolUseId: call.id,
    });
    if (decision.behavior === "deny") {
      const denial: DenialOutcome = {
        block: {
          type: "tool_result",
          tool_use_id: call.id,
          content: decision.message,
          is_error: true,
        },
        interrupt: decision.interrupt === true,
        message: decision.message,
      };
      return { result: denial.block, denial };
    }
    if (
      decision.behavior === "allow" &&
      isPlainToolInput(decision.updatedInput)
    ) {
      effectiveInput = decision.updatedInput;
    }
  }

  const toolResult = maskToolResultSecrets(
    await executeTool(call.name, effectiveInput, {
      toolUseId: call.id,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.abortSignal !== undefined
        ? { signal: options.abortSignal }
        : {}),
      ...(options.workflowContext !== undefined
        ? {
            workflow: options.workflowContext,
            scopeId: options.workflowContext.scopeId,
            projectId: options.workflowContext.projectId,
          }
        : {}),
      ...(options.tokenBudget !== undefined
        ? { tokenBudget: options.tokenBudget }
        : {}),
    }),
  );
  return {
    result: {
      type: "tool_result",
      tool_use_id: call.id,
      content: toolResult.blocks ? toolResult.blocks : toolResult.content,
      ...(toolResult.structuredContent
        ? { structuredContent: toolResult.structuredContent }
        : {}),
      ...(toolResult._meta ? { _meta: toolResult._meta } : {}),
      is_error: toolResult.is_error === true,
    },
  };
}
