import type {
  Content,
  FunctionCall,
  FunctionDeclaration,
  Part,
  Tool,
} from "@google/genai";
import type {
  AgentCanUseTool,
  AgentHarnessRunOptions,
  KotaTool,
} from "#core/agent-harness/index.js";
import { executeTool, getAllTools } from "#core/tools/index.js";
import { maskToolResultSecrets } from "#core/tools/secret-masking.js";
import { GEMINI_ASK_OWNER_TOOL_NAME } from "./constants.js";

type ToolInput = Parameters<AgentCanUseTool>[1];
type FunctionCallArgs = FunctionCall["args"];

function isPlainToolInput(
  value: FunctionCallArgs | ToolInput | undefined,
): value is ToolInput {
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
  if (includeAskOwner && allowSet) allowSet.add(GEMINI_ASK_OWNER_TOOL_NAME);
  return all.filter((tool) => {
    if (denySet.has(tool.name)) return false;
    if (allowSet && !allowSet.has(tool.name)) return false;
    return true;
  });
}

export function buildGeminiToolList(
  kotaTools: readonly KotaTool[],
): Tool[] | undefined {
  if (kotaTools.length === 0) return undefined;
  const declarations: FunctionDeclaration[] = kotaTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.input_schema,
  }));
  return [{ functionDeclarations: declarations }];
}

export function makeUserPromptContent(prompt: string): Content {
  return { role: "user", parts: [{ text: prompt }] };
}

export function extractTextFromContent(content: Content | undefined): string {
  if (!content?.parts) return "";
  let text = "";
  for (const part of content.parts) {
    if (typeof part.text === "string" && part.thought !== true) {
      text += part.text;
    }
  }
  return text;
}

export function extractFunctionCallsFromContent(
  content: Content | undefined,
): FunctionCall[] {
  if (!content?.parts) return [];
  const calls: FunctionCall[] = [];
  for (const part of content.parts) {
    if (part.functionCall) calls.push(part.functionCall);
  }
  return calls;
}

export function mergeContent(
  prev: Content | undefined,
  next: Content,
): Content {
  if (!prev) return { role: next.role ?? "model", parts: [...(next.parts ?? [])] };
  return {
    role: prev.role ?? next.role ?? "model",
    parts: [...(prev.parts ?? []), ...(next.parts ?? [])],
  };
}

export type DenialOutcome = {
  responsePart: Part;
  interrupt: boolean;
  message: string;
};

type DispatchResult = {
  responsePart: Part;
  denial?: DenialOutcome;
};

function functionResponsePart(
  call: FunctionCall,
  body: { output: string } | { error: string },
): Part {
  return {
    functionResponse: {
      ...(call.id !== undefined ? { id: call.id } : {}),
      name: call.name ?? "",
      response: body,
    },
  };
}

export async function dispatchFunctionCall(
  call: FunctionCall,
  guardrails: {
    canUseTool: AgentCanUseTool | undefined;
    allowedTools: readonly string[] | undefined;
    disallowedTools: readonly string[] | undefined;
    abortSignal: AbortSignal | undefined;
    workflowContext: AgentHarnessRunOptions["workflowContext"];
    tokenBudget: AgentHarnessRunOptions["tokenBudget"];
    cwd: AgentHarnessRunOptions["cwd"];
    env: AgentHarnessRunOptions["env"];
  },
): Promise<DispatchResult> {
  const name = call.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      "Gemini model returned a malformed functionCall: missing tool name.",
    );
  }
  const args = call.args;
  if (args !== undefined && !isPlainToolInput(args)) {
    throw new Error(
      `Gemini model returned a malformed functionCall for "${name}": args must be a JSON object, got ${
        args === null ? "null" : Array.isArray(args) ? "array" : typeof args
      }.`,
    );
  }
  const validatedInput = args ?? {};

  const denySet = new Set(guardrails.disallowedTools ?? []);
  if (denySet.has(name)) {
    const message = `Tool "${name}" is in disallowedTools and cannot run.`;
    const part = functionResponsePart(call, { error: message });
    return {
      responsePart: part,
      denial: { responsePart: part, interrupt: false, message },
    };
  }
  if (
    guardrails.allowedTools &&
    guardrails.allowedTools.length > 0 &&
    !guardrails.allowedTools.includes(name)
  ) {
    const message = `Tool "${name}" is not in allowedTools and cannot run.`;
    const part = functionResponsePart(call, { error: message });
    return {
      responsePart: part,
      denial: { responsePart: part, interrupt: false, message },
    };
  }

  let effectiveInput: ToolInput = validatedInput;
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
    const decision = await guardrails.canUseTool(name, validatedInput, {
      signal: toolAbort.signal,
      suggestions: [],
      toolUseId: call.id ?? name,
    });
    if (decision.behavior === "deny") {
      const part = functionResponsePart(call, { error: decision.message });
      return {
        responsePart: part,
        denial: {
          responsePart: part,
          interrupt: decision.interrupt === true,
          message: decision.message,
        },
      };
    }
    if (
      decision.behavior === "allow" &&
      isPlainToolInput(decision.updatedInput)
    ) {
      effectiveInput = decision.updatedInput;
    }
  }

  const result = maskToolResultSecrets(
    await executeTool(name, effectiveInput, {
      toolUseId: call.id ?? name,
      ...(guardrails.cwd !== undefined ? { cwd: guardrails.cwd } : {}),
      ...(guardrails.env !== undefined ? { env: guardrails.env } : {}),
      ...(guardrails.abortSignal !== undefined
        ? { signal: guardrails.abortSignal }
        : {}),
      ...(guardrails.workflowContext !== undefined
        ? {
            workflow: guardrails.workflowContext,
            scopeId: guardrails.workflowContext.scopeId,
            projectId: guardrails.workflowContext.projectId,
          }
        : {}),
      ...(guardrails.tokenBudget !== undefined
        ? { tokenBudget: guardrails.tokenBudget }
        : {}),
    }),
  );
  const body =
    result.is_error === true
      ? { error: result.content }
      : { output: result.content };
  return { responsePart: functionResponsePart(call, body) };
}
