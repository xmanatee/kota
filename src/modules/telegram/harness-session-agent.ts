import { randomUUID } from "node:crypto";
import {
  type AgentEffort,
  type AgentHarness,
  type AgentHarnessResult,
  type AgentHarnessSessionContext,
  createNativeAgentInvalidationLifecycle,
  routeKotaToolControlOptions,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import { harnessSupportsRunOption } from "#core/agent-harness/run-option-routing.js";
import { resetAgentConversation } from "#core/agent-harness/session-continuity.js";
import {
  type AgentHarnessTranscriptTurn,
  composeAgentHarnessTranscriptPrompt,
} from "#core/agent-harness/transcript.js";
import type { KotaConfig } from "#core/config/config.js";
import type { DaemonRuntimeScopeProvider } from "#core/daemon/runtime-scope-provider.js";
import { capScopeAutonomyMode } from "#core/daemon/scope-policy.js";
import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
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
  resolveRuntimeScope: DaemonRuntimeScopeProvider["resolve"];
  continuityKey?: string;
  config: KotaConfig;
  scopeRuntime?: Pick<ScopeRuntime, "scopePolicyAuthority" | "authorityConfigPath" | "approvalQueue" | "idempotencyStore">;
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
  private execution: ReturnType<typeof runAgentHarness> | undefined;
  private closing: Promise<void> | undefined;

  constructor(private readonly options: TelegramHarnessSessionAgentOptions) {
    this.sessionContext = {
      sessionId: options.continuityKey ?? `telegram:${randomUUID()}`,
      scopeId: options.scopeId,
    };
    registerSessionEnvironment(this.sessionContext);
  }

  async send(text: string): Promise<void> {
    if (this.closed) throw new Error("The Telegram conversation is closed.");
    const authority = this.options.scopeRuntime?.scopePolicyAuthority;
    const getScopePolicySnapshot = authority === undefined ? undefined : () => authority.getSnapshot(this.options.scopeId);
    const snapshot = getScopePolicySnapshot?.();
    const invalidation = createNativeAgentInvalidationLifecycle({
      executionLabel: "Telegram agent",
      ...(this.options.harness.toolControl === "native" ? {
        scopeId: this.options.scopeId, authority, initialSnapshot: snapshot,
      } : {}),
    });
    const abortController = invalidation.abortController;
    this.abortController = abortController;
    const prompt = harnessSupportsRunOption(this.options.harness, "resumeSessionId")
      ? text : composeAgentHarnessTranscriptPrompt(this.transcript, text);
    let streamedText = "";
    const writer = {
      write: (chunk: string): boolean => {
        streamedText += chunk;
        this.options.proxy.emit({ type: "text", content: chunk });
        return true;
      },
    };

    try {
      this.execution = runAgentHarness(
        this.options.harness,
        {
          prompt,
          model: this.options.model,
          scopeRoot: this.options.scopeRoot,
          resolveRuntimeScope: this.options.resolveRuntimeScope,
          cwd: this.options.cwd,
          effort: this.options.effort,
          autonomyMode: snapshot === undefined ? this.options.autonomyMode : capScopeAutonomyMode(this.options.autonomyMode, snapshot.policy),
          ...routeKotaToolControlOptions(this.options.harness, {
            scopePolicy: snapshot?.policy, scopePolicyAuthority: authority, getScopePolicySnapshot,
          }),
          authorityConfigPath: this.options.scopeRuntime?.authorityConfigPath,
          ...(this.options.harness.toolControl === "kota" ? {
            approvalQueue: this.options.scopeRuntime?.approvalQueue,
            idempotencyStore: this.options.scopeRuntime?.idempotencyStore,
            guardrailsConfig: this.options.config.guardrails,
          } : {}),
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
      const result = await this.execution;
      if (!streamedText && result.text) {
        this.options.proxy.emit({ type: "text", content: result.text });
      }
      this.recordCost(result);
      this.transcript.push({
        user: text,
        assistant: result.text || streamedText,
      });
    } finally {
      invalidation.dispose();
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    this.abortController?.abort(new Error("Telegram harness session closed."));
    this.abortController = null;
    this.closing = (async () => {
      await this.execution?.catch(() => {});
      await unregisterSessionEnvironment(this.sessionContext);
      await this.execution?.settled;
    })();
    return this.closing;
  }

  async reset(): Promise<void> {
    await this.close();
    resetAgentConversation(this.options.scopeRoot, this.sessionContext.sessionId, "Operator cleared the Telegram conversation.");
  }

  getCostSummary(): string {
    return this.costTracker.getSummary();
  }

  private recordCost(result: AgentHarnessResult): void {
    if (result.usage.cost.state === "complete") {
      this.costTracker.addRawCost(result.usage.cost.usd);
      return;
    }
    if (result.usage.tokens.state === "unknown") {
      return;
    }
    this.costTracker.addUsage(this.options.model, {
      input_tokens: result.usage.tokens.inputTokens,
      output_tokens: result.usage.tokens.outputTokens,
    });
  }
}
