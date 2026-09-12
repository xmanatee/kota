import { z } from "zod";
import { createConversationSessionRuntime } from "#core/agent-harness/conversation-runtime.js";
import { SessionRecoveryError } from "#core/agent-harness/session-continuity.js";
/**
 * `gemini` agent harness: a multi-turn tool-calling loop driven by the
 * Google Gen AI SDK (`models.generateContentStream` plus Gemini function
 * declarations). The adapter owns orchestration; option validation, tool
 * dispatch, and token-budget result shaping live in local helpers.
 */

import type {
  Content,
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
  ThinkingConfig,
} from "@google/genai";
import {
  type AgentEffort,
  type AgentHarness,
  type AgentHarnessResult,
  type AgentHarnessRunOptions,
  type AgentHarnessWriter,
  AgentUsageAccumulator,
  agentHarnessToolExecutionOptions,
  unpricedAgentUsage,
} from "#core/agent-harness/index.js";
import { runWithAskOwnerSource } from "#core/tools/ask-owner.js";
import {
  DEFAULT_MAX_TURNS,
  GEMINI_AGENT_HARNESS_NAME,
  GEMINI_ASK_OWNER_TOOL_NAME,
} from "./constants.js";
import {
  GEMINI_UNSUPPORTED_OPTIONS,
  geminiReadiness,
  rejectUnsupportedOptions,
} from "./options.js";
import {
  geminiTokenBudgetErrorResult,
  geminiTokenBudgetSource,
} from "./token-budget.js";
import {
  buildGeminiToolList,
  type DenialOutcome,
  dispatchFunctionCall,
  extractFunctionCallsFromContent,
  extractTextFromContent,
  makeUserPromptContent,
  mergeContent,
  selectToolDefinitions,
} from "./tool-loop.js";

export {
  GEMINI_AGENT_HARNESS_NAME,
  GEMINI_ASK_OWNER_TOOL_NAME,
} from "./constants.js";

async function loadGenAi(): Promise<typeof import("@google/genai")> {
  return import("@google/genai");
}

function mapEffortToThinkingConfig(effort: AgentEffort): ThinkingConfig {
  if (effort === "low") {
    return { thinkingLevel: "LOW" as ThinkingConfig["thinkingLevel"] };
  }
  if (effort === "medium") {
    return { thinkingLevel: "MEDIUM" as ThinkingConfig["thinkingLevel"] };
  }
  return { thinkingLevel: "HIGH" as ThinkingConfig["thinkingLevel"] };
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

  const session = createConversationSessionRuntime({
    harness: GEMINI_AGENT_HARNESS_NAME, options,
    scopeRoot: options.scopeRoot ?? options.cwd ?? process.cwd(),
    resolved: { model: options.model, providerName: "google-genai" },
    // The SDK owns its output limit; zero denotes no KOTA override.
    outputTokenLimit: { maxTokens: 0 },
  });
  const conversation: Content[] = session.adapterState === undefined
    ? [] : decodeGeminiConversation(session.adapterState);
  session.validateTools(kotaTools, undefined);
  const pending = extractFunctionCallsFromContent(conversation.at(-1));
  if (pending.length > 0) conversation.push({ role: "user", parts: pending.map((call) => ({
    functionResponse: { id: call.id, name: call.name, response: { error: "Interrupted before a durable result. The effect may have happened; inspect saved work before acting. Do not replay this call." } },
  })) });
  conversation.push(makeUserPromptContent(options.prompt));
  const checkpoint = () => session.checkpointAdapter(z.json().parse(JSON.parse(JSON.stringify(conversation))));
  checkpoint();
  const streamedChunks: string[] = [];
  const usage = new AgentUsageAccumulator();
  let lastResponseId: string | undefined;
  let finalText = "";
  let turnCount = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    checkAborted(options.abortController?.signal);
    const tokenBudgetSource = geminiTokenBudgetSource(
      options,
      options.model,
      turn + 1,
    );
    const exhaustion = options.tokenBudget?.checkCanStartTurn(tokenBudgetSource);
    if (exhaustion) {
      return geminiTokenBudgetErrorResult({
        message: exhaustion.message,
        streamedChunks,
        sessionId: session.sessionId ?? lastResponseId,
        turnCount,
        usage: turnCount === 0
          ? unpricedAgentUsage(0, 0)
          : usage.snapshot(),
      });
    }

    const config: GenerateContentConfig = {
      thinkingConfig,
      ...(options.systemPrompt !== undefined
        ? { systemInstruction: options.systemPrompt }
        : {}),
      ...(toolList ? { tools: toolList } : {}),
      ...(options.abortController?.signal
        ? { abortSignal: options.abortController.signal }
        : {}),
    };

    const stream = await client.models.generateContentStream({
      model: options.model,
      contents: [...conversation],
      config,
    });

    let aggregatedContent: Content | undefined;
    let lastChunk: GenerateContentResponse | undefined;
    let turnInputTokens: number | undefined;
    let turnOutputTokens: number | undefined;

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
        turnInputTokens = chunk.usageMetadata.promptTokenCount ?? turnInputTokens;
        turnOutputTokens =
          chunk.usageMetadata.candidatesTokenCount ?? turnOutputTokens;
      }
      if (chunk.responseId) lastResponseId = chunk.responseId;
    }

    turnCount += 1;
    usage.observe(unpricedAgentUsage(turnInputTokens, turnOutputTokens));
    options.tokenBudget?.debitUsage(
      {
        inputTokens: turnInputTokens,
        outputTokens: turnOutputTokens,
      },
      tokenBudgetSource,
    );
    const turnText = extractTextFromContent(aggregatedContent);
    if (turnText.length > 0) finalText = turnText;

    const functionCalls = extractFunctionCallsFromContent(aggregatedContent);
    const assistantContent: Content = aggregatedContent ?? {
      role: "model",
      parts: [],
    };
    if (!assistantContent.role) assistantContent.role = "model";
    conversation.push(assistantContent);
    checkpoint();

    const turnExhaustion = options.tokenBudget?.checkAfterDebit(tokenBudgetSource);
    if (turnExhaustion) {
      return geminiTokenBudgetErrorResult({
        message:
          functionCalls.length > 0
            ? `${turnExhaustion.message} Function calls were not executed because the harness cannot continue to consume their results.`
            : turnExhaustion.message,
        streamedChunks,
        sessionId: session.sessionId ?? lastResponseId,
        turnCount,
        usage: usage.snapshot(),
      });
    }

    if (
      functionCalls.length === 0 ||
      lastChunk?.candidates?.[0]?.finishReason === "STOP"
    ) {
      return {
        text: finalText,
        streamedText: streamedChunks.join(""),
        ...((session.sessionId ?? lastResponseId) === undefined ? {} : { sessionId: session.sessionId ?? lastResponseId }),
        turns: turnCount,
        usage: usage.snapshot(),
        isError: false,
      };
    }

    const responseParts: Part[] = [];
    let interruptDenial: DenialOutcome | undefined;
    for (const call of functionCalls) {
      const dispatched = await dispatchFunctionCall(
        call,
        agentHarnessToolExecutionOptions(options, { resultLimit: 50_000 }),
      );
      responseParts.push(dispatched.responsePart);
      if (dispatched.denial?.interrupt && !interruptDenial) {
        interruptDenial = dispatched.denial;
      }
    }

    conversation.push({ role: "user", parts: responseParts });
    checkpoint();

    if (interruptDenial) {
      const message = `canUseTool interrupted the loop: ${interruptDenial.message}`;
      return {
        text: message,
        streamedText: streamedChunks.join(""),
        ...((session.sessionId ?? lastResponseId) === undefined ? {} : { sessionId: session.sessionId ?? lastResponseId }),
        turns: turnCount,
        usage: usage.snapshot(),
        isError: true,
        subtype: "interrupted_by_can_use_tool",
      };
    }
  }

  return {
    text: finalText || `gemini harness reached maxTurns=${maxTurns} without ending.`,
    streamedText: streamedChunks.join(""),
    ...((session.sessionId ?? lastResponseId) === undefined ? {} : { sessionId: session.sessionId ?? lastResponseId }),
    turns: turnCount,
    usage: usage.snapshot(),
    isError: true,
    subtype: "max_turns_reached",
  };
}

// Retain provider parts (including thought signatures) losslessly. Only this
// adapter interprets their wire format; core stores JSON without translating it.
function decodeGeminiConversation(value: unknown): Content[] {
  const decoded = z.array(z.object({
    role: z.enum(["user", "model"]),
    parts: z.array(z.looseObject({
      text: z.string().optional(), thought: z.boolean().optional(), thoughtSignature: z.string().optional(),
      functionCall: z.object({ id: z.string().optional(), name: z.string(), args: z.record(z.string(), z.json()).optional() }).optional(),
      functionResponse: z.object({ id: z.string().optional(), name: z.string(), response: z.record(z.string(), z.json()) }).optional(),
    })),
  })).safeParse(value);
  if (!decoded.success) {
    throw new SessionRecoveryError("The saved Gemini conversation is corrupt or incompatible; the original state was retained.");
  }
  return decoded.data;
}
