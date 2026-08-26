import { randomUUID } from "node:crypto";
import {
  type AgentEffort,
  type AgentHarness,
  type AgentHarnessSessionContext,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import {
  type AgentHarnessTranscriptTurn,
  composeAgentHarnessTranscriptPrompt,
} from "#core/agent-harness/transcript.js";
import type { KotaConfig } from "#core/config/config.js";
import { CostTracker } from "#core/loop/cost.js";
import { buildKotaSystemPrompt } from "#core/loop/system-prompt.js";
import type { ProxyTransport } from "#core/loop/transport.js";
import type { ModelProviderSelection } from "#core/model/model-client.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  registerSessionEnvironment,
  unregisterSessionEnvironment,
} from "#core/tools/session-environment.js";

export type TelegramHarnessSessionAgentOptions = {
  harness: AgentHarness;
  model: string;
  modelProvider?: ModelProviderSelection;
  modelOutputTokenLimits?: KotaConfig["modelOutputTokenLimits"];
  effort: AgentEffort;
  scopeRoot: string;
  cwd: string;
  scopeId: string;
  config: KotaConfig;
  autonomyMode: AutonomyMode;
  verbose?: boolean;
  proxy: ProxyTransport;
};

/** Persistent Telegram transcript plus its exact KOTA tool-runtime lifetime. */
export class TelegramHarnessSessionAgent {
  private readonly transcript: AgentHarnessTranscriptTurn[] = [];
  private readonly costTracker = new CostTracker();
  private readonly sessionContext: AgentHarnessSessionContext;
  private abortController: AbortController | null = null;
  private closed = false;

  constructor(private readonly options: TelegramHarnessSessionAgentOptions) {
    this.sessionContext = {
      sessionId: `telegram:${randomUUID()}`,
      scopeId: options.scopeId,
    };
    registerSessionEnvironment(this.sessionContext);
  }

  async send(text: string): Promise<void> {
    const abortController = new AbortController();
    this.abortController = abortController;
    const prompt = composeAgentHarnessTranscriptPrompt(this.transcript, text);
    let streamedText = "";
    const writer = {
      write: (chunk: string): boolean => {
        streamedText += chunk;
        this.options.proxy.emit({ type: "text", content: chunk });
        return true;
      },
    };

    try {
      const result = await runAgentHarness(
        this.options.harness,
        {
          prompt,
          model: this.options.model,
          scopeRoot: this.options.scopeRoot,
          cwd: this.options.cwd,
          effort: this.options.effort,
          autonomyMode: this.options.autonomyMode,
          verbose: this.options.verbose ?? this.options.config.verbose,
          systemPrompt: buildKotaSystemPrompt(
            this.options.config,
            undefined,
            this.options.cwd,
            this.options.scopeRoot,
          ),
          modelOutputTokenLimits: this.options.modelOutputTokenLimits,
          sessionContext: this.sessionContext,
          abortController,
          ...(this.options.modelProvider !== undefined
            ? { modelProvider: this.options.modelProvider }
            : {}),
        },
        writer,
      );
      if (!streamedText && result.text) {
        this.options.proxy.emit({ type: "text", content: result.text });
      }
      this.recordCost(result);
      this.transcript.push({
        user: text,
        assistant: result.text || streamedText,
      });
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abortController?.abort(new Error("Telegram harness session closed."));
    this.abortController = null;
    unregisterSessionEnvironment(this.sessionContext);
  }

  getCostSummary(): string {
    return this.costTracker.getSummary();
  }

  private recordCost(result: {
    totalCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
  }): void {
    if (result.totalCostUsd !== undefined) {
      this.costTracker.addRawCost(result.totalCostUsd);
      return;
    }
    if (result.inputTokens === undefined && result.outputTokens === undefined) {
      return;
    }
    this.costTracker.addUsage(this.options.model, {
      input_tokens: result.inputTokens ?? 0,
      output_tokens: result.outputTokens ?? 0,
    });
  }
}
