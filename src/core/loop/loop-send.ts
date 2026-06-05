import type {
  KotaTextBlock,
  KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import { formatResolvedToolGuidance } from "#core/agents/tool-guidance.js";
import { formatTaskHint, routeTask } from "#core/daemon/task-router.js";
import { tryEmit } from "#core/events/event-bus.js";
import { streamMessage } from "#core/model/streaming.js";
import { getAllTools } from "#core/tools/index.js";
import { detectToolGroups, enableGroup, filterTools } from "#core/tools/tool-groups.js";
import { executeToolCalls, FailureTracker } from "#core/tools/tool-runner.js";
import { getToolTelemetry } from "#core/tools/tool-telemetry.js";
import { CONTEXT_WINDOW } from "./context.js";
import { collectDynamicState } from "./dynamic-state.js";
import { getChangeTracker } from "./file-changes.js";
import type { AgentLoopState } from "./loop-init.js";
import { saveToHistoryImpl } from "./loop-init.js";
import { runPreSendHooks } from "./pre-send-hooks.js";
import { buildReflectionPrompt, getLastAssistantText, shouldReflect } from "./reflection.js";
import { analyzeRequest, formatContextHint } from "./request-analyzer.js";
import { processToolResults } from "./verify-tracker.js";

const MAX_ITERATIONS = 200;

function abortReason(signal: AbortSignal): Error {
  const { reason } = signal;
  return reason instanceof Error ? reason : new Error("Session cancelled");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

export async function runSend(state: AgentLoopState, prompt: string): Promise<string> {
  if (state.closed) throw new Error("Session is closed");
  const abortController = new AbortController();
  state.activeAbortControllers.add(abortController);
  const { signal } = abortController;

  try {
    if (!state.initialized) await state.initPromise;
    throwIfAborted(signal);
    if (state.sessionStartTime === 0) {
      state.sessionStartTime = Date.now();
      tryEmit("session.start", {
        sessionId: state.sessionId,
        label: state.sessionLabel,
        channelIdentity: state.channelIdentity,
      });
    }

    const analysis = analyzeRequest(prompt, state.projectDir);
    const taskRoute = routeTask(prompt);
    let augmentedPrompt = prompt;
    if (analysis) augmentedPrompt += formatContextHint(analysis);
    augmentedPrompt += formatTaskHint(taskRoute);

    state.context.addUserMessage(augmentedPrompt);
    for (const g of detectToolGroups(prompt)) enableGroup(g);
    if (taskRoute) {
      for (const g of taskRoute.groups) enableGroup(g);
    }
    let lastResult = "";

    const mcpTools = state.mcpManager ? state.mcpManager.getTools() : [];

    const preSendResults = await runPreSendHooks({
      client: state.client,
      model: state.model,
      editorModel: state.editorModel,
      maxTokens: state.maxTokens,
      effectiveMaxTokens: state.effectiveMaxTokens,
      systemContext: state.context.getSystemPrompt(),
      messages: state.context.getMessages(),
      costTracker: state.costTracker,
      verbose: state.verbose,
      thinkingConfig: state.thinkingConfig,
      transport: state.transport,
    });
    throwIfAborted(signal);
    for (const result of preSendResults) {
      if (result.modifiedFiles) {
        for (const f of result.modifiedFiles) state.verifyTracker.recordEdit(f);
      }
      if (result.assistantText) state.context.addAssistantText(result.assistantText);
      if (result.userFollowup) state.context.addUserMessage(result.userFollowup);
      if (result.lastResult !== undefined) lastResult = result.lastResult;
    }

    const failureTracker = new FailureTracker();
    let reflectionDone = false;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      throwIfAborted(signal);
      const maskStats = state.context.maskOldObservations();
      if (maskStats.maskedCount > 0) {
        state.transport.emit({
          type: "status",
          message: `[kota] Masked ${maskStats.maskedCount} old observations (saved ~${Math.round(maskStats.charsSaved / 4)} tokens)`,
        });
      }

      if (state.context.needsCompaction()) {
        if (state.verbose) state.transport.emit({ type: "status", message: "[kota] Compacting context..." });
        await state.context.compact(state.client, state.model);
        throwIfAborted(signal);
      }

      if (state.verbose) {
        const stats = state.context.getStats();
        state.transport.emit({
          type: "status",
          message: `[kota] Turn ${i + 1} (${stats.turns} messages, ${stats.compactions} compactions)`,
        });
      }

      const activeTools = [...filterTools(getAllTools()), ...mcpTools];
      const activeToolNames = new Set(activeTools.map((t) => t.name));

      const system: KotaTextBlock[] = [
        { type: "text", text: state.context.getStaticPrompt(), cache_control: { type: "ephemeral" } },
      ];
      const changesSummary = getChangeTracker()?.getSummary() ?? "";
      const telemetrySummary = getToolTelemetry().getSummary();
      const telemetryBlock = telemetrySummary ? `\n<tool-metrics>${telemetrySummary}</tool-metrics>` : "";
      const toolGuidance = formatResolvedToolGuidance(activeTools);
      const dynamicState = toolGuidance + state.context.getDynamicState() + state.verifyTracker.getState() + changesSummary + collectDynamicState({ activeTools: activeToolNames }) + telemetryBlock;
      if (dynamicState) {
        system.push({ type: "text", text: dynamicState });
      }

      if (state.stateMachine.canTransition("thinking")) {
        state.stateMachine.transition("thinking", { turn: i + 1 });
      }

      const { response, streamedText } = await streamMessage({
        client: state.client,
        model: state.model,
        maxTokens: state.effectiveMaxTokens,
        system,
        messages: state.context.getMessages(),
        tools: activeTools,
        thinkingConfig: state.thinkingConfig,
        transport: state.transport,
        signal,
      });
      throwIfAborted(signal);

      if (streamedText) {
        state.transport.emit({ type: "text", content: "\n" });
        lastResult = streamedText;
      }

      state.context.setInputTokens(response.usage.input_tokens);
      const prevTotal = state.costTracker.getTotalCost();
      state.costTracker.addUsage(state.model, response.usage);
      const totalCostUsd = state.costTracker.getTotalCost();
      const turnCostUsd = totalCostUsd - prevTotal;
      const budgetPct = Math.round(state.context.getBudgetPercent() * 100);
      state.transport.emit({
        type: "cost",
        summary: `Turn ${i + 1} — ${state.costTracker.getSummary()}`,
        budgetPercent: budgetPct,
        turn: i + 1,
        turnCostUsd,
        totalCostUsd,
      });

      if (state.verbose) {
        const u = response.usage;
        state.transport.emit({
          type: "status",
          message: `[kota] Tokens: input=${u.input_tokens}/${CONTEXT_WINDOW}` +
            (u.cache_read_input_tokens ? `, cache_read=${u.cache_read_input_tokens}` : "") +
            (u.cache_creation_input_tokens ? `, cache_created=${u.cache_creation_input_tokens}` : ""),
        });
      }

      state.context.addAssistantMessage(response);

      const toolBlocks = response.content.filter(
        (b): b is KotaToolUseBlock => b.type === "tool_use",
      );

      if (toolBlocks.length === 0) {
        if (state.reflectionEnabled && !reflectionDone) {
          const responseText = streamedText || getLastAssistantText(state.context.getMessages());
          if (shouldReflect(state.context.getMessages(), responseText)) {
            reflectionDone = true;
            if (state.stateMachine.canTransition("reflecting")) {
              state.stateMachine.transition("reflecting");
            }
            const reflectionPrompt = buildReflectionPrompt(state.context.getMessages());
            state.context.addUserMessage(reflectionPrompt);
            state.transport.emit({ type: "status", message: "[kota] Self-reflecting on response quality..." });
            continue;
          }
        }
        break;
      }

      if (state.stateMachine.canTransition("acting")) {
        state.stateMachine.transition("acting", { toolCount: toolBlocks.length });
      }

      const resultLimit = state.context.getToolResultLimit();
      const validResults = await executeToolCalls(toolBlocks, {
        resultLimit,
        verbose: state.verbose,
        autonomyMode: state.autonomyMode,
        mcpManager: state.mcpManager ?? undefined,
        mcpInputResolver: state.mcpInputResolver,
        transport: state.transport,
        guardrailsConfig: state.guardrailsConfig,
        clientApprovalResolver: state.clientApprovalResolver,
        sessionId: state.sessionId,
        messages: state.context.getMessages(),
        idempotencyStore: state.idempotencyStore,
        signal,
      });
      throwIfAborted(signal);
      state.context.addToolResults(validResults);

      processToolResults(state.verifyTracker, toolBlocks, validResults);

      if (state.sessionPath) state.context.save(state.sessionPath);
      saveToHistoryImpl(state);

      const action = failureTracker.record(validResults);
      if (action !== "continue") {
        const msg = FailureTracker.getMessage(action);
        state.transport.emit({
          type: "error",
          message: `[kota] ${action === "circuit_break" ? "Circuit breaker" : "Failure guidance"}: ${msg}`,
        });
        state.context.addUserMessage(msg);
      }
    }

    throwIfAborted(signal);
    if (state.sessionPath) state.context.save(state.sessionPath);
    saveToHistoryImpl(state);
    if (state.stateMachine.canTransition("ready")) {
      state.stateMachine.transition("ready");
    }
    return lastResult;
  } finally {
    state.activeAbortControllers.delete(abortController);
  }
}
