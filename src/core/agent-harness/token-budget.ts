import type { KotaModelUsage } from "./message-protocol.js";

export const TOKEN_BUDGET_EXHAUSTED_SUBTYPE = "token_budget_exhausted";

export type AgentTokenBudgetConfig = {
  maxTotalTokens: number;
};

export type AgentTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type AgentTokenBudgetSourceKind =
  | "session-turn"
  | "delegate-turn"
  | "harness-turn"
  | "harness-run"
  | "harness-result"
  | "workflow-agent-step";

export type AgentTokenBudgetSource = {
  kind: AgentTokenBudgetSourceKind;
  workflowName?: string;
  runId?: string;
  stepId?: string;
  spanId?: string;
  harness?: string;
  model?: string;
  turn?: number;
  childAgent?: string;
};

export type AgentTokenBudgetDiagnostic =
  | {
      kind: "missing-usage";
      at: string;
      source: AgentTokenBudgetSource;
      message: string;
    }
  | {
      kind: "non-enforcing";
      at: string;
      source: AgentTokenBudgetSource;
      message: string;
    };

export type AgentTokenBudgetDebit = {
  at: string;
  source: AgentTokenBudgetSource;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalAfterDebit: number;
};

export type AgentTokenBudgetExhaustion = {
  subtype: typeof TOKEN_BUDGET_EXHAUSTED_SUBTYPE;
  message: string;
  source: AgentTokenBudgetSource;
  budgetMaxTotalTokens: number;
  totalTokens: number;
  remainingTokens: number;
};

export type AgentTokenBudgetSnapshot = {
  budget: AgentTokenBudgetConfig;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  remainingTokens: number;
  exhausted: boolean;
  exhaustedAt?: string;
  exhaustedBy?: AgentTokenBudgetSource;
  debits: AgentTokenBudgetDebit[];
  diagnostics: AgentTokenBudgetDiagnostic[];
};

function finiteNonNegativeInteger(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

function formatSource(source: AgentTokenBudgetSource): string {
  const parts: string[] = [source.kind];
  if (source.workflowName) parts.push(`workflow=${source.workflowName}`);
  if (source.runId) parts.push(`run=${source.runId}`);
  if (source.stepId) parts.push(`step=${source.stepId}`);
  if (source.harness) parts.push(`harness=${source.harness}`);
  if (source.model) parts.push(`model=${source.model}`);
  if (source.turn !== undefined) parts.push(`turn=${source.turn}`);
  if (source.childAgent) parts.push(`child=${source.childAgent}`);
  return parts.join(" ");
}

function exhaustionMessage(
  config: AgentTokenBudgetConfig,
  totalTokens: number,
  source: AgentTokenBudgetSource,
  timing: "after-usage" | "before-turn",
): string {
  const timingText = timing === "after-usage"
    ? "after model usage was reported"
    : "before another model turn";
  return (
    `Agent token budget exhausted ${timingText}: ` +
    `${totalTokens}/${config.maxTotalTokens} tokens used (${formatSource(source)}).`
  );
}

export function agentTokenUsageFromModelUsage(
  usage: KotaModelUsage | undefined,
): AgentTokenUsage {
  if (usage === undefined) return {};
  return {
    inputTokens: finiteNonNegativeInteger(usage.input_tokens),
    outputTokens: finiteNonNegativeInteger(usage.output_tokens),
  };
}

export class AgentTokenBudgetLedger {
  private inputTokens = 0;
  private outputTokens = 0;
  private readonly debits: AgentTokenBudgetDebit[] = [];
  private readonly diagnostics: AgentTokenBudgetDiagnostic[] = [];
  private exhaustedAt: string | undefined;
  private exhaustedBy: AgentTokenBudgetSource | undefined;

  constructor(
    private readonly config: AgentTokenBudgetConfig,
    private readonly parent?: AgentTokenBudgetLedger,
  ) {
    if (
      !Number.isInteger(config.maxTotalTokens) ||
      config.maxTotalTokens < 1
    ) {
      throw new Error("Agent token budget maxTotalTokens must be an integer >= 1");
    }
  }

  createChild(config: AgentTokenBudgetConfig): AgentTokenBudgetLedger {
    return new AgentTokenBudgetLedger(config, this);
  }

  debitCount(): number {
    return this.debits.length;
  }

  hasDebitSince(
    initialDebitCount: number,
    matches: (debit: AgentTokenBudgetDebit) => boolean,
  ): boolean {
    const start = Math.max(0, Math.min(initialDebitCount, this.debits.length));
    return this.debits.slice(start).some(matches);
  }

  checkCanStartTurn(source: AgentTokenBudgetSource): AgentTokenBudgetExhaustion | null {
    const parentExhaustion = this.parent?.checkCanStartTurn(source);
    if (parentExhaustion) return parentExhaustion;
    const totalTokens = this.totalTokens();
    if (totalTokens < this.config.maxTotalTokens) return null;
    const at = new Date().toISOString();
    this.markExhausted(at, source);
    return {
      subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
      message: exhaustionMessage(this.config, totalTokens, source, "before-turn"),
      source,
      budgetMaxTotalTokens: this.config.maxTotalTokens,
      totalTokens,
      remainingTokens: 0,
    };
  }

  checkAfterDebit(source: AgentTokenBudgetSource): AgentTokenBudgetExhaustion | null {
    const parentExhaustion = this.parent?.checkAfterDebit(source);
    if (parentExhaustion) return parentExhaustion;
    const totalTokens = this.totalTokens();
    if (totalTokens < this.config.maxTotalTokens) return null;
    const at = new Date().toISOString();
    this.markExhausted(at, source);
    return {
      subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
      message: exhaustionMessage(this.config, totalTokens, source, "after-usage"),
      source,
      budgetMaxTotalTokens: this.config.maxTotalTokens,
      totalTokens,
      remainingTokens: 0,
    };
  }

  debitUsage(usage: AgentTokenUsage, source: AgentTokenBudgetSource): void {
    const inputTokens = finiteNonNegativeInteger(usage.inputTokens);
    const outputTokens = finiteNonNegativeInteger(usage.outputTokens);
    if (inputTokens === undefined && outputTokens === undefined) {
      this.recordMissingUsage(
        source,
        "No inputTokens or outputTokens were reported for this model turn.",
      );
      return;
    }
    const normalizedInput = inputTokens ?? 0;
    const normalizedOutput = outputTokens ?? 0;
    const totalTokens = normalizedInput + normalizedOutput;
    const at = new Date().toISOString();
    this.inputTokens += normalizedInput;
    this.outputTokens += normalizedOutput;
    this.debits.push({
      at,
      source,
      inputTokens: normalizedInput,
      outputTokens: normalizedOutput,
      totalTokens,
      totalAfterDebit: this.totalTokens(),
    });
    if (this.totalTokens() >= this.config.maxTotalTokens) {
      this.markExhausted(at, source);
    }
    this.parent?.debitUsage(usage, source);
  }

  recordMissingUsage(source: AgentTokenBudgetSource, message: string): void {
    this.recordDiagnostic({ kind: "missing-usage", at: new Date().toISOString(), source, message });
  }

  recordNonEnforcing(source: AgentTokenBudgetSource, message: string): void {
    this.recordDiagnostic({ kind: "non-enforcing", at: new Date().toISOString(), source, message });
  }

  snapshot(): AgentTokenBudgetSnapshot {
    const totalTokens = this.totalTokens();
    return {
      budget: { ...this.config },
      usage: {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        totalTokens,
      },
      remainingTokens: Math.max(0, this.config.maxTotalTokens - totalTokens),
      exhausted: totalTokens >= this.config.maxTotalTokens,
      ...(this.exhaustedAt !== undefined ? { exhaustedAt: this.exhaustedAt } : {}),
      ...(this.exhaustedBy !== undefined ? { exhaustedBy: this.exhaustedBy } : {}),
      debits: this.debits.map((entry) => ({ ...entry, source: { ...entry.source } })),
      diagnostics: this.diagnostics.map((entry) => ({ ...entry, source: { ...entry.source } })),
    };
  }

  private totalTokens(): number {
    return this.inputTokens + this.outputTokens;
  }

  private markExhausted(at: string, source: AgentTokenBudgetSource): void {
    if (this.exhaustedAt !== undefined) return;
    this.exhaustedAt = at;
    this.exhaustedBy = source;
  }

  private recordDiagnostic(diagnostic: AgentTokenBudgetDiagnostic): void {
    this.diagnostics.push(diagnostic);
    this.parent?.recordDiagnostic(diagnostic);
  }
}
