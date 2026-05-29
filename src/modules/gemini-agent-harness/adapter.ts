/**
 * `gemini` agent harness — a multi-turn tool-calling loop driven by the
 * Google Gen AI SDK (`@google/genai`'s `models.generateContentStream` plus
 * a tool catalog of `functionDeclarations`).
 *
 * The Gemini SDK does not run an internal tool loop on the client side; the
 * adapter consumes the stream, dispatches every emitted `functionCall` through
 * the core tool registry under KOTA's guardrails (`canUseTool`,
 * `allowedTools`, `disallowedTools`), and feeds the results back as
 * `functionResponse` parts on the next turn until the model returns a
 * function-call-free turn or `maxTurns` is reached.
 */

import type {
  Content,
  FunctionCall,
  FunctionDeclaration,
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
  ThinkingConfig,
  Tool,
} from "@google/genai";

import type {
  AgentCanUseTool,
  AgentEffort,
  AgentHarness,
  AgentHarnessReadiness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
  AgentHarnessWriter,
  KotaTool,
} from "#core/agent-harness/index.js";
import {
  probeNativeCliRuntime,
  probeNodePackageRuntime,
} from "#core/agent-harness/index.js";
import { runWithAskOwnerSource } from "#core/tools/ask-owner.js";
import { executeTool, getAllTools } from "#core/tools/index.js";
import { maskToolResultSecrets } from "#core/tools/secret-masking.js";

/**
 * Lazy `@google/genai` import. Mirrors `vercel-agent-harness` — keeps module
 * discovery cheap when the operator never selects this adapter, and avoids
 * pulling the SDK's transitive runtime side effects into module load.
 */
async function loadGenAi(): Promise<typeof import("@google/genai")> {
  return import("@google/genai");
}

export const GEMINI_AGENT_HARNESS_NAME = "gemini";
export const GEMINI_ASK_OWNER_TOOL_NAME = "ask_owner";

const DEFAULT_MAX_TURNS = 25;

const GEMINI_UNSUPPORTED_OPTIONS = [
  {
    runOption: "mcpServers",
    option: "mcpServers",
    reason: "The Gemini SDK adapter hosts KOTA tools directly, not MCP servers.",
  },
  {
    runOption: "autonomyMode.supervised",
    option: 'autonomyMode="supervised"',
    reason: "The adapter cannot route tool calls through KOTA's approval queue.",
  },
  {
    runOption: "persistSession",
    option: "persistSession",
    reason: "The Gemini SDK loop does not persist native sessions.",
  },
  {
    runOption: "harnessOverrides",
    option: "harnessOverrides",
    reason: "The gemini adapter does not accept per-step harnessOptions.",
  },
  {
    runOption: "enableFileCheckpointing",
    option: "enableFileCheckpointing",
    reason: "KOTA file checkpointing is not supported by this adapter.",
  },
  {
    runOption: "thinking",
    option: "thinkingEnabled/thinkingBudget",
    reason: "Portable effort maps to Gemini thinkingConfig.thinkingLevel instead.",
  },
  {
    runOption: "onMessage",
    option: "onMessage",
    reason: "The adapter emits text deltas, not KotaAgentMessage frames.",
  },
] as const satisfies readonly AgentHarnessUnsupportedOption[];

function geminiReadiness(): AgentHarnessReadiness {
  return {
    adapterKind: "provider-sdk",
    localRuntime: probeNodePackageRuntime({
      packageName: "@google/genai",
      required: true,
    }),
    optionalRuntimes: [
      probeNativeCliRuntime({
        binaryName: "gemini",
        versionArgs: ["--version"],
        required: false,
        missingSummary:
          "gemini CLI not found on PATH; this is informational because KOTA's gemini harness is SDK-backed",
      }),
    ],
    unsupportedOptions: GEMINI_UNSUPPORTED_OPTIONS,
  };
}

function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "gemini" agent harness does not host MCP servers. Drop mcpServers ' +
        "or run the claude-agent-sdk harness which proxies them through the SDK.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "gemini" agent harness cannot route tool calls through the operator approval queue. ' +
        'Use autonomyMode "autonomous" or "passive", or run claude-agent-sdk.',
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "gemini" agent harness does not persist sessions. ' +
        "Drop persistSession or run claude-agent-sdk for native session resumption.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "gemini" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["gemini"] or run an adapter that validates them.',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "gemini" agent harness does not support file checkpointing. ' +
        "Drop enableFileCheckpointing or run claude-agent-sdk.",
    );
  }
  if (options.thinkingEnabled === true) {
    throw new Error(
      'The "gemini" agent harness does not host extended thinking through the ' +
        'thinkingEnabled toggle. Use the portable "effort" field — gemini maps ' +
        "it to thinkingConfig.thinkingLevel — or run claude-agent-sdk.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "gemini" agent harness does not emit KotaAgentMessage frames. ' +
        "Drop onMessage or run claude-agent-sdk.",
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectToolDefinitions(
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

/**
 * Translate the filtered KOTA tool catalog into Gemini's single-`Tool` shape
 * with one `functionDeclarations` entry per tool. Gemini's
 * `FunctionDeclaration.parametersJsonSchema` accepts a JSON Schema object and
 * passes it to the model verbatim, so the KOTA tool's `input_schema` (already
 * a JSON Schema `object`) round-trips without translation.
 */
function buildGeminiToolList(kotaTools: readonly KotaTool[]): Tool[] | undefined {
  if (kotaTools.length === 0) return undefined;
  const declarations: FunctionDeclaration[] = kotaTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.input_schema,
  }));
  return [{ functionDeclarations: declarations }];
}

function mapEffortToThinkingConfig(effort: AgentEffort): ThinkingConfig {
  if (effort === "low") return { thinkingLevel: "LOW" as ThinkingConfig["thinkingLevel"] };
  if (effort === "medium") return { thinkingLevel: "MEDIUM" as ThinkingConfig["thinkingLevel"] };
  return { thinkingLevel: "HIGH" as ThinkingConfig["thinkingLevel"] };
}

function makeUserPromptContent(prompt: string): Content {
  return { role: "user", parts: [{ text: prompt }] };
}

function extractTextFromContent(content: Content | undefined): string {
  if (!content?.parts) return "";
  let text = "";
  for (const part of content.parts) {
    if (typeof part.text === "string" && part.thought !== true) {
      text += part.text;
    }
  }
  return text;
}

function extractFunctionCallsFromContent(content: Content | undefined): FunctionCall[] {
  if (!content?.parts) return [];
  const calls: FunctionCall[] = [];
  for (const part of content.parts) {
    if (part.functionCall) calls.push(part.functionCall);
  }
  return calls;
}

type DenialOutcome = {
  responsePart: Part;
  interrupt: boolean;
  message: string;
};

type DispatchResult = {
  responsePart: Part;
  denial?: DenialOutcome;
};

function functionResponsePart(call: FunctionCall, body: { output: string } | { error: string }): Part {
  return {
    functionResponse: {
      ...(call.id !== undefined ? { id: call.id } : {}),
      name: call.name ?? "",
      response: body,
    },
  };
}

async function dispatchFunctionCall(
  call: FunctionCall,
  guardrails: {
    canUseTool: AgentCanUseTool | undefined;
    allowedTools: readonly string[] | undefined;
    disallowedTools: readonly string[] | undefined;
    abortSignal: AbortSignal | undefined;
  },
): Promise<DispatchResult> {
  const name = call.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      "Gemini model returned a malformed functionCall: missing tool name.",
    );
  }
  const args = call.args;
  if (args !== undefined && !isPlainRecord(args)) {
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
    return { responsePart: part, denial: { responsePart: part, interrupt: false, message } };
  }
  if (
    guardrails.allowedTools &&
    guardrails.allowedTools.length > 0 &&
    !guardrails.allowedTools.includes(name)
  ) {
    const message = `Tool "${name}" is not in allowedTools and cannot run.`;
    const part = functionResponsePart(call, { error: message });
    return { responsePart: part, denial: { responsePart: part, interrupt: false, message } };
  }

  let effectiveInput = validatedInput;
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
        denial: { responsePart: part, interrupt: decision.interrupt === true, message: decision.message },
      };
    }
    if (decision.behavior === "allow" && isPlainRecord(decision.updatedInput)) {
      effectiveInput = decision.updatedInput;
    }
  }

  const result = maskToolResultSecrets(await executeTool(name, effectiveInput));
  const body = result.is_error === true
    ? { error: result.content }
    : { output: result.content };
  return { responsePart: functionResponsePart(call, body) };
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    throw reason instanceof Error ? reason : new Error("Agent execution aborted");
  }
}

export const geminiAgentHarness: AgentHarness = {
  name: GEMINI_AGENT_HARNESS_NAME,
  description:
    "Multi-turn tool-calling loop on the Google Gen AI SDK (models.generateContentStream + functionDeclarations). Honors canUseTool, allowedTools, disallowedTools.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: GEMINI_ASK_OWNER_TOOL_NAME,
  emitsAgentMessageStream: false,
  toolControl: "kota",
  unsupportedRunOptions: GEMINI_UNSUPPORTED_OPTIONS,
  readiness: geminiReadiness,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    if (options.askOwner) {
      return runWithAskOwnerSource(options.askOwner.source, () =>
        runGeminiLoop(options, writer),
      );
    }
    return runGeminiLoop(options, writer);
  },
};

async function runGeminiLoop(
  options: AgentHarnessRunOptions,
  writer?: AgentHarnessWriter,
): Promise<AgentHarnessResult> {
  rejectUnsupportedOptions(options);
  if (!options.model) {
    throw new Error(
      'The "gemini" agent harness requires an explicit model on the step or config.',
    );
  }
  checkAborted(options.abortController?.signal);

  const genai = await loadGenAi();
  const client: GoogleGenAI = new genai.GoogleGenAI({});
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const kotaTools = selectToolDefinitions(
    options.allowedTools,
    options.disallowedTools,
    options.askOwner !== undefined,
  );
  const toolList = buildGeminiToolList(kotaTools);
  const thinkingConfig = mapEffortToThinkingConfig(options.effort);

  const conversation: Content[] = [makeUserPromptContent(options.prompt)];
  const streamedChunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let lastResponseId: string | undefined;
  let finalText = "";
  let turnCount = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    checkAborted(options.abortController?.signal);

    const config: GenerateContentConfig = {
      thinkingConfig,
      ...(options.systemPrompt !== undefined ? { systemInstruction: options.systemPrompt } : {}),
      ...(toolList ? { tools: toolList } : {}),
      ...(options.abortController?.signal ? { abortSignal: options.abortController.signal } : {}),
    };

    const stream = await client.models.generateContentStream({
      model: options.model,
      contents: [...conversation],
      config,
    });

    let aggregatedContent: Content | undefined;
    let lastChunk: GenerateContentResponse | undefined;

    for await (const chunk of stream) {
      lastChunk = chunk;
      const candidate = chunk.candidates?.[0];
      const candidateContent = candidate?.content;
      if (candidateContent?.parts) {
        for (const part of candidateContent.parts) {
          if (typeof part.text === "string" && part.thought !== true) {
            streamedChunks.push(part.text);
            if (writer) writer.write(part.text);
          }
        }
        aggregatedContent = mergeContent(aggregatedContent, candidateContent);
      }
      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
      if (chunk.responseId) lastResponseId = chunk.responseId;
    }

    turnCount += 1;
    const turnText = extractTextFromContent(aggregatedContent);
    if (turnText.length > 0) finalText = turnText;

    const functionCalls = extractFunctionCallsFromContent(aggregatedContent);

    const assistantContent: Content = aggregatedContent ?? { role: "model", parts: [] };
    if (!assistantContent.role) assistantContent.role = "model";
    conversation.push(assistantContent);

    if (functionCalls.length === 0 || lastChunk?.candidates?.[0]?.finishReason === "STOP") {
      return {
        text: finalText,
        streamedText: streamedChunks.join(""),
        ...(lastResponseId !== undefined ? { sessionId: lastResponseId } : {}),
        turns: turnCount,
        inputTokens,
        outputTokens,
        isError: false,
      };
    }

    const responseParts: Part[] = [];
    let interruptDenial: DenialOutcome | undefined;
    for (const call of functionCalls) {
      const dispatched = await dispatchFunctionCall(call, {
        canUseTool: options.canUseTool,
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
        abortSignal: options.abortController?.signal,
      });
      responseParts.push(dispatched.responsePart);
      if (dispatched.denial?.interrupt && !interruptDenial) {
        interruptDenial = dispatched.denial;
      }
    }

    conversation.push({ role: "user", parts: responseParts });

    if (interruptDenial) {
      const message = `canUseTool interrupted the loop: ${interruptDenial.message}`;
      return {
        text: message,
        streamedText: streamedChunks.join(""),
        ...(lastResponseId !== undefined ? { sessionId: lastResponseId } : {}),
        turns: turnCount,
        inputTokens,
        outputTokens,
        isError: true,
        subtype: "interrupted_by_can_use_tool",
      };
    }
  }

  return {
    text: finalText || `gemini harness reached maxTurns=${maxTurns} without ending.`,
    streamedText: streamedChunks.join(""),
    ...(lastResponseId !== undefined ? { sessionId: lastResponseId } : {}),
    turns: turnCount,
    inputTokens,
    outputTokens,
    isError: true,
    subtype: "max_turns_reached",
  };
}

/**
 * Concatenate streamed chunks of one assistant turn into a single `Content`.
 * Streamed text parts append; functionCall parts append. Gemini may emit
 * multiple chunks per turn — we re-aggregate into the canonical `Content`
 * shape the conversation history needs for the next turn.
 */
function mergeContent(prev: Content | undefined, next: Content): Content {
  if (!prev) return { role: next.role ?? "model", parts: [...(next.parts ?? [])] };
  return {
    role: prev.role ?? next.role ?? "model",
    parts: [...(prev.parts ?? []), ...(next.parts ?? [])],
  };
}
