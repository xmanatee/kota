import { afterEach, describe, expect, it, vi } from "vitest";
import { resetHarnessHooks } from "./hooks.js";
import { runAgentHarness } from "./runner.js";
import { harnessStub } from "./runner-fixtures.integration.js";
import { AgentTokenBudgetLedger, TOKEN_BUDGET_EXHAUSTED_SUBTYPE } from "./token-budget.js";

describe("runAgentHarness token budget", () => {
  afterEach(() => {
    resetHarnessHooks();
    vi.restoreAllMocks();
  });

  it("debits aggregate result usage and records non-enforcing diagnostics", async () => {
    const { harness, run } = harnessStub("native-cli", ["preRun", "postRun"]);
    run.mockResolvedValueOnce({
      text: "done",
      streamedText: "done",
      turns: 3,
      inputTokens: 10,
      outputTokens: 4,
      isError: false,
    });
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });

    const result = await runAgentHarness(harness, {
      prompt: "x",
      effort: "xhigh",
      tokenBudget,
    });

    expect(result.isError).toBe(false);
    expect(tokenBudget.snapshot()).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      diagnostics: [
        {
          kind: "non-enforcing",
          source: { kind: "harness-result", harness: "native-cli" },
        },
      ],
    });
  });

  it("debits aggregate result usage when a child tool debited the shared ledger during the run", async () => {
    const { harness, run } = harnessStub("aggregate-tool-loop", ["preRun", "postRun"]);
    run.mockImplementationOnce(async (options) => {
      options.tokenBudget?.debitUsage(
        { inputTokens: 2, outputTokens: 3 },
        { kind: "delegate-turn", model: "child-model", turn: 1 },
      );
      return {
        text: "done",
        streamedText: "done",
        turns: 1,
        inputTokens: 10,
        outputTokens: 4,
        isError: false,
      };
    });
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });

    const result = await runAgentHarness(harness, {
      prompt: "x",
      effort: "xhigh",
      tokenBudget,
    });

    expect(result.isError).toBe(false);
    expect(tokenBudget.snapshot()).toMatchObject({
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      debits: [
        { source: { kind: "delegate-turn", model: "child-model" }, totalTokens: 5 },
        {
          source: { kind: "harness-result", harness: "aggregate-tool-loop" },
          totalTokens: 14,
        },
      ],
      diagnostics: [
        {
          kind: "non-enforcing",
          source: { kind: "harness-result", harness: "aggregate-tool-loop" },
        },
      ],
    });
  });

  it("does not double-debit aggregate result usage when the adapter already debited its own turns", async () => {
    const { harness, run } = harnessStub("turn-loop", ["preRun", "postRun"]);
    run.mockImplementationOnce(async (options) => {
      options.tokenBudget?.debitUsage(
        { inputTokens: 6, outputTokens: 2 },
        { kind: "harness-turn", harness: "turn-loop", model: "m", turn: 1 },
      );
      return {
        text: "done",
        streamedText: "done",
        turns: 1,
        inputTokens: 6,
        outputTokens: 2,
        isError: false,
      };
    });
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });

    await runAgentHarness(harness, {
      prompt: "x",
      effort: "xhigh",
      tokenBudget,
    });

    expect(tokenBudget.snapshot()).toMatchObject({
      usage: { inputTokens: 6, outputTokens: 2, totalTokens: 8 },
      debits: [
        { source: { kind: "harness-turn", harness: "turn-loop" }, totalTokens: 8 },
      ],
      diagnostics: [],
    });
  });

  it("returns token_budget_exhausted before adapter dispatch when the ledger is exhausted", async () => {
    const { harness, run } = harnessStub("alpha", ["preRun", "postRun"]);
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 5 });
    tokenBudget.debitUsage(
      { inputTokens: 5 },
      { kind: "harness-result", harness: "previous" },
    );

    const result = await runAgentHarness(harness, {
      prompt: "x",
      effort: "xhigh",
      tokenBudget,
    });

    expect(result).toMatchObject({
      isError: true,
      subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
      turns: 0,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
