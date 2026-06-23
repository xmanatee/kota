import { describe, expect, it } from "vitest";
import {
  AgentTokenBudgetLedger,
  TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
} from "./token-budget.js";

describe("AgentTokenBudgetLedger", () => {
  it("tracks usage under budget", () => {
    const ledger = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });

    ledger.debitUsage(
      { inputTokens: 20, outputTokens: 10 },
      { kind: "harness-turn", harness: "test", model: "m", turn: 1 },
    );

    expect(ledger.checkCanStartTurn({ kind: "harness-turn", turn: 2 })).toBeNull();
    expect(ledger.snapshot()).toMatchObject({
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      remainingTokens: 70,
      exhausted: false,
    });
  });

  it("refuses another model turn after the total budget is exhausted", () => {
    const ledger = new AgentTokenBudgetLedger({ maxTotalTokens: 25 });

    ledger.debitUsage(
      { inputTokens: 20, outputTokens: 5 },
      { kind: "session-turn", model: "m", turn: 1 },
    );

    const exhaustion = ledger.checkCanStartTurn({
      kind: "session-turn",
      model: "m",
      turn: 2,
    });
    expect(exhaustion).toMatchObject({
      subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
      budgetMaxTotalTokens: 25,
      totalTokens: 25,
      remainingTokens: 0,
    });
    expect(ledger.snapshot().exhausted).toBe(true);
  });

  it("reports exhaustion immediately after a debit reaches the budget", () => {
    const ledger = new AgentTokenBudgetLedger({ maxTotalTokens: 25 });
    const source = { kind: "session-turn" as const, model: "m", turn: 1 };

    ledger.debitUsage({ inputTokens: 20, outputTokens: 5 }, source);

    expect(ledger.checkAfterDebit(source)).toMatchObject({
      subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
      budgetMaxTotalTokens: 25,
      totalTokens: 25,
      remainingTokens: 0,
      source,
    });
  });

  it("records missing usage as a diagnostic without debiting tokens", () => {
    const ledger = new AgentTokenBudgetLedger({ maxTotalTokens: 10 });

    ledger.debitUsage({}, { kind: "harness-result", harness: "native" });

    expect(ledger.snapshot()).toMatchObject({
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      diagnostics: [
        {
          kind: "missing-usage",
          source: { kind: "harness-result", harness: "native" },
        },
      ],
    });
  });

  it("debits parent budgets from child ledgers", () => {
    const parent = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });
    const child = parent.createChild({ maxTotalTokens: 20 });

    child.debitUsage(
      { inputTokens: 12, outputTokens: 3 },
      { kind: "harness-turn", harness: "child", turn: 1 },
    );

    expect(child.snapshot().usage.totalTokens).toBe(15);
    expect(parent.snapshot().usage.totalTokens).toBe(15);
  });

  it("enforces a narrower child budget while preserving parent remaining tokens", () => {
    const parent = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });
    const child = parent.createChild({ maxTotalTokens: 10 });

    child.debitUsage(
      { inputTokens: 8, outputTokens: 2 },
      { kind: "harness-turn", harness: "child", turn: 1 },
    );

    expect(child.checkCanStartTurn({ kind: "harness-turn", turn: 2 })).toMatchObject({
      subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
      totalTokens: 10,
    });
    expect(parent.checkCanStartTurn({ kind: "harness-turn", turn: 2 })).toBeNull();
    expect(parent.snapshot().remainingTokens).toBe(90);
  });
});
