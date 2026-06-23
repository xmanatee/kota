import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type HarnessHookKind,
  registerHarnessHook,
  resetHarnessHooks,
} from "./hooks.js";
import {
  routeKotaToolControlOptions,
  runAgentHarness,
  shouldRouteKotaToolControl,
} from "./runner.js";
import { AgentTokenBudgetLedger, TOKEN_BUDGET_EXHAUSTED_SUBTYPE } from "./token-budget.js";
import type { AgentHarness } from "./types.js";

function harnessStub(
  name: string,
  supportedHookKinds: readonly HarnessHookKind[],
): { harness: AgentHarness; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => ({
    text: `${name}-ok`,
    streamedText: `${name}-ok`,
    turns: 1,
    isError: false,
  }));
  return {
    harness: {
      name,
      description: `stub ${name}`,
      supportsMultiTurn: true,
      supportedHookKinds,
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run,
    },
    run,
  };
}

describe("runAgentHarness", () => {
  afterEach(() => {
    resetHarnessHooks();
    vi.restoreAllMocks();
  });

  it("invokes preRun and postRun hooks around the adapter's native run", async () => {
    const preRun = vi.fn();
    const postRun = vi.fn();
    registerHarnessHook({
      kind: "preRun",
      owner: "observer",
      name: "before",
      handler: preRun,
    });
    registerHarnessHook({
      kind: "postRun",
      owner: "observer",
      name: "after",
      handler: postRun,
    });

    const { harness, run } = harnessStub("alpha", ["preRun", "postRun"]);

    const result = await runAgentHarness(harness, {
      prompt: "hello",
      effort: "xhigh",
    });

    expect(result.text).toBe("alpha-ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(preRun).toHaveBeenCalledTimes(1);
    expect(postRun).toHaveBeenCalledTimes(1);
    expect(preRun.mock.calls[0][0].harness.name).toBe("alpha");
    expect(postRun.mock.calls[0][0].result).toMatchObject({ text: "alpha-ok" });
    expect(preRun.mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[0],
    );
    expect(run.mock.invocationCallOrder[0]).toBeLessThan(
      postRun.mock.invocationCallOrder[0],
    );
  });

  it("fires each registered hook exactly once for every adapter it targets", async () => {
    const preRun = vi.fn();
    registerHarnessHook({
      kind: "preRun",
      owner: "observer",
      name: "count",
      handler: preRun,
    });

    const { harness: a } = harnessStub("alpha", ["preRun", "postRun"]);
    const { harness: b } = harnessStub("beta", ["preRun", "postRun"]);

    await runAgentHarness(a, { prompt: "x", effort: "xhigh" });
    await runAgentHarness(b, { prompt: "y", effort: "xhigh" });

    expect(preRun).toHaveBeenCalledTimes(2);
    expect(preRun.mock.calls[0][0].harness.name).toBe("alpha");
    expect(preRun.mock.calls[1][0].harness.name).toBe("beta");
  });

  it("rejects the call if a hook kind is registered for an adapter that does not host it", async () => {
    registerHarnessHook({
      kind: "preRun",
      owner: "observer",
      name: "unhosted",
      handler: () => {},
    });

    const { harness, run } = harnessStub("no-hooks", []);

    await expect(
      runAgentHarness(harness, { prompt: "x", effort: "xhigh" }),
    ).rejects.toThrow(/"no-hooks".*"preRun".*Remove the hook/);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the adapter without hooks when none are registered", async () => {
    const { harness, run } = harnessStub("alpha", ["preRun", "postRun"]);
    await runAgentHarness(harness, { prompt: "hello", effort: "xhigh" });
    expect(run).toHaveBeenCalledTimes(1);
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

  it("rejects declared unsupported run options before hooks or adapter run", async () => {
    const preRun = vi.fn();
    registerHarnessHook({
      kind: "preRun",
      owner: "observer",
      name: "before",
      handler: preRun,
    });
    const { harness, run } = harnessStub("native-cli", ["preRun", "postRun"]);
    const unsupportedHarness: AgentHarness = {
      ...harness,
      unsupportedRunOptions: [
        {
          runOption: "canUseTool",
          option: "canUseTool",
          reason: "native CLI tool calls cannot pass through KOTA guards",
        },
      ],
    };

    await expect(
      runAgentHarness(unsupportedHarness, {
        prompt: "x",
        effort: "xhigh",
        canUseTool: async () => ({ behavior: "allow" }),
      }),
    ).rejects.toThrow(/native-cli.*canUseTool.*native CLI tool calls/);
    expect(preRun).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("routes KOTA tool-control options only to KOTA-controlled harnesses", () => {
    const { harness } = harnessStub("tool-loop", ["preRun", "postRun"]);

    expect(shouldRouteKotaToolControl(harness)).toBe(true);
    expect(shouldRouteKotaToolControl({ ...harness, toolControl: "native" })).toBe(false);
    expect(routeKotaToolControlOptions(harness, { allowedTools: ["Read"] })).toEqual({
      allowedTools: ["Read"],
    });
    expect(
      routeKotaToolControlOptions(
        { ...harness, toolControl: "native" },
        { allowedTools: ["Read"] },
      ),
    ).toEqual({});
  });
});
