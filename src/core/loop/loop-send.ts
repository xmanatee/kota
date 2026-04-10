import type Anthropic from "@anthropic-ai/sdk";
import { runArchitectStep } from "#core/architect/runner.js";
import { analyzeRequest, formatContextHint } from "#root/request-analyzer.js";
import { processToolResults } from "#root/verify-tracker.js";
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
import { buildReflectionPrompt, getLastAssistantText, shouldReflect } from "./reflection.js";

const MAX_ITERATIONS = 200;

export async function runSend(state: AgentLoopState, prompt: string): Promise<string> {
  if (!state.initialized) await state.initPromise;
  if (state.sessionStartTime === 0) {
    state.sessionStartTime = Date.now();
    tryEmit("session.start", { sessionId: state.sessionId, label: state.sessionLabel });
  }

  const analysis = analyzeRequest(prompt, process.cwd());
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

  if (state.architectMode) {
    const result = await runArchitectStep({
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
    if (result) {
      lastResult = result.lastResult;
      for (const f of result.modifiedFiles) state.verifyTracker.recordEdit(f);
      state.context.addAssistantText(result.summary);
      state.context.addUserMessage(
        "The architect/editor has made changes. " +
        "Verify they are correct: run builds, tests, or type checks as appropriate.",
      );
    }
  }

  const failureTracker = new FailureTracker();
  let reflectionDone = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
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
    }

    if (state.verbose) {
      const stats = state.context.getStats();
      state.transport.emit({
        type: "status",
        message: `[kota] Turn ${i + 1} (${stats.turns} messages, ${stats.compactions} compactions)`,
      });
    }

    const system: Anthropic.Messages.TextBlockParam[] = [
      { type: "text", text: state.context.getStaticPrompt(), cache_control: { type: "ephemeral" } },
    ];
    const changesSummary = getChangeTracker()?.getSummary() ?? "";
    const telemetrySummary = getToolTelemetry().getSummary();
    const telemetryBlock = telemetrySummary ? `\n<tool-metrics>${telemetrySummary}</tool-metrics>` : "";
    const dynamicState = state.context.getDynamicState() + state.verifyTracker.getState() + changesSummary + collectDynamicState() + telemetryBlock;
    if (dynamicState) {
      system.push({ type: "text", text: dynamicState });
    }

    const activeTools = [...filterTools(getAllTools()), ...mcpTools];

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
    });

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
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
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
    const validResults = await executeToolCalls(
      toolBlocks, resultLimit, state.verbose, state.mcpManager ?? undefined, state.transport,
      state.guardrailsConfig, state.sessionId, state.context.getMessages(),
    );
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

  if (state.sessionPath) state.context.save(state.sessionPath);
  saveToHistoryImpl(state);
  if (state.stateMachine.canTransition("ready")) {
    state.stateMachine.transition("ready");
  }
  return lastResult;
}
