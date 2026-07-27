import type {
  Content,
  FunctionCall,
  FunctionDeclaration,
  Part,
  Tool,
} from "@google/genai";
import type {
  AgentCanUseTool,
  KotaTool,
} from "#core/agent-harness/index.js";
import { getAllTools } from "#core/tools/index.js";
import {
  executeToolCalls,
  type ToolCallExecutionOptions,
  ToolPermissionInterruptedError,
} from "#core/tools/tool-runner.js";
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
  executionOptions: ToolCallExecutionOptions,
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
  try {
    const [result] = await executeToolCalls(
      [
        {
          type: "tool_use",
          id: call.id ?? name,
          name,
          input: validatedInput,
        },
      ],
      executionOptions,
    );
    if (!result) {
      throw new Error(`Gemini tool runner returned no result for "${name}".`);
    }
    const body =
      result.is_error === true
        ? { error: result.content }
        : { output: result.content };
    return { responsePart: functionResponsePart(call, body) };
  } catch (error) {
    if (!(error instanceof ToolPermissionInterruptedError)) throw error;
    const part = functionResponsePart(call, { error: error.result.content });
    return {
      responsePart: part,
      denial: {
        responsePart: part,
        interrupt: true,
        message: error.result.content,
      },
    };
  }
}
