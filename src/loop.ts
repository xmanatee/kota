import type Anthropic from "@anthropic-ai/sdk";
import type { KotaConfig } from "./config.js";
import type { Context } from "./context.js";
import type { CostTracker } from "./cost.js";
import type { ExtensionLoader } from "./extension-loader.js";
import type { GuardrailsConfig } from "./guardrails.js";
import { initAgentSession } from "./loop-constructor.js";
import { type AgentLoopState, runClose, saveToHistoryImpl } from "./loop-init.js";
import { runSend } from "./loop-send.js";
import type { McpManager } from "./mcp/manager.js";
import type { ModelClient } from "./model/model-client.js";
import type { ModelTiers } from "./model/model-router.js";
import type { SessionState, SessionStateMachine } from "./session-state.js";
import { BufferTransport, type Transport } from "./transport.js";
import type { VerifyTracker } from "./verify-tracker.js";

export type LoopOptions = {
  model?: string;
  editorModel?: string;
  maxTokens?: number;
  verbose?: boolean;
  architectMode?: boolean;
  sessionPath?: string;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  transport?: Transport;
  config?: KotaConfig;
  /** Resume a specific conversation by ID. */
  resumeConversation?: string;
  /** Disable automatic conversation history tracking. */
  noHistory?: boolean;
  /** Tag conversations as "action" (autonomous) vs "user" (interactive). Affects history pruning. */
  historySource?: "user" | "action";
  /** Optional label for event bus (e.g. "build-agent", "user-repl"). */
  label?: string;
  /** Enable self-reflection before delivering final response. Default: true. */
  reflectionEnabled?: boolean;
  /** Inject a model client (for testing with mock clients or alternative providers). */
  client?: ModelClient;
  /** Show per-turn cost line in terminal output (default: true). */
  showCost?: boolean;
};

/**
 * Persistent agent session that maintains context across multiple prompts.
 * Used by both single-shot mode and interactive REPL.
 */
export class AgentSession {
  private client!: ModelClient;
  private context!: Context;
  private costTracker!: CostTracker;
  private model!: string;
  private editorModel!: string;
  private maxTokens!: number;
  private effectiveMaxTokens!: number;
  private verbose!: boolean;
  private architectMode!: boolean;
  private sessionPath?: string;
  private thinkingConfig?: Anthropic.Messages.ThinkingConfigParam;
  private verifyTracker!: VerifyTracker;
  private mcpManager: McpManager | null = null;
  private extensionLoader!: ExtensionLoader;
  private transport!: Transport;
  private sigintHandler!: () => void;
  private closed = false;
  private initialized = false;
  private initPromise!: Promise<void>;
  private projectContext!: string;
  private instructionContext!: string;
  private conversationId: string | null = null;
  private historyEnabled!: boolean;
  private historySource!: "user" | "action";
  private sessionId!: string;
  private sessionLabel?: string;
  private sessionStartTime = 0;
  private guardrailsConfig!: GuardrailsConfig;
  private reflectionEnabled!: boolean;
  private modelTiers?: ModelTiers;
  private stateMachine!: SessionStateMachine;

  constructor(options: LoopOptions = {}) {
    initAgentSession(this as unknown as AgentLoopState, options, (opts) => {
      const session = new AgentSession({
        model: opts.model || this.model,
        config: options.config,
        transport: new BufferTransport(),
        label: opts.label,
        noHistory: opts.noHistory ?? true,
        historySource: "action",
        reflectionEnabled: false,
      });
      return {
        send: (prompt: string) => session.send(prompt),
        close: () => session.close(),
      };
    });
  }

  /** Send a prompt and run the agent loop until the agent stops. */
  async send(prompt: string): Promise<string> {
    return runSend(this as unknown as AgentLoopState, prompt);
  }

  /** Save current state to conversation history. Creates the entry lazily on first call with messages. */
  private saveToHistory(): void {
    saveToHistoryImpl(this as unknown as AgentLoopState);
  }

  getCostSummary(): string { return this.costTracker.getSummary(); }

  getState(): SessionState { return this.stateMachine.current(); }

  getConversationId(): string | null { return this.conversationId; }

  /** Clean up handlers and save final state. */
  close(errored = false): void {
    process.removeListener("SIGINT", this.sigintHandler);
    runClose(this as unknown as AgentLoopState, errored);
  }
}

/** Convenience wrapper: create a session, send one prompt, close. */
export async function runAgentLoop(
  prompt: string,
  options: LoopOptions = {},
): Promise<string> {
  const session = new AgentSession(options);
  let errored = false;
  try {
    return await session.send(prompt);
  } catch (err) {
    errored = true;
    throw err;
  } finally {
    session.close(errored);
  }
}
