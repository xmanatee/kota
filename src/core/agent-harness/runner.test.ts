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
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
} from "./types.js";

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

  it("quarantines callbacks, writer output, and success returned after cancellation", async () => {
    const abortController = new AbortController();
    const abortReason = new Error("scope authority revision became restrictive");
    const acceptedMessages = vi.fn();
    const acceptedWriterOutput = vi.fn(() => true);
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let releaseHarness = () => {};
    const released = new Promise<void>((resolve) => {
      releaseHarness = resolve;
    });
    let markHarnessFinished = () => {};
    const harnessFinished = new Promise<void>((resolve) => {
      markHarnessFinished = resolve;
    });
    let lateWriterAccepted: boolean | undefined;
    let quarantineStarted = false;
    const harness: AgentHarness = {
      name: "opaque-native",
      description: "ignores cancellation and returns stale success",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: true,
      toolControl: "native",
      nativeAbortQuarantine: "confirmed-stop",
      async run(options: AgentHarnessRunOptions, writer) {
        options.abortQuarantine?.register(async () => {
          quarantineStarted = true;
          releaseHarness();
          await harnessFinished;
        });
        await options.onMessage?.({ type: "status", category: "started" });
        markStarted();
        await released;
        lateWriterAccepted = writer?.write("stale native output");
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "late-write",
          toolName: "native_write",
          input: { path: "after-restriction.txt" },
        });
        markHarnessFinished();
        return {
          text: "stale success",
          streamedText: "stale success",
          turns: 1,
          isError: false,
        };
      },
    };

    const run = runAgentHarness(
      harness,
      {
        prompt: "x",
        effort: "xhigh",
        abortController,
        onMessage: acceptedMessages,
      },
      { write: acceptedWriterOutput },
    );
    await started;
    abortController.abort(abortReason);

    await expect(run).rejects.toBe(abortReason);
    await harnessFinished;
    expect(quarantineStarted).toBe(true);
    expect(acceptedMessages).toHaveBeenCalledTimes(1);
    expect(acceptedMessages).toHaveBeenCalledWith({ type: "status", category: "started" });
    expect(acceptedWriterOutput).not.toHaveBeenCalled();
    expect(lateWriterAccepted).toBe(false);
  });

  it("rejects a cancellable native harness before launch without a stop contract", async () => {
    const { harness, run } = harnessStub("unsafe-native", []);
    const unsafeHarness: AgentHarness = { ...harness, toolControl: "native" };

    await expect(
      runAgentHarness(unsafeHarness, {
        prompt: "x",
        effort: "xhigh",
        abortController: new AbortController(),
      }),
    ).rejects.toThrow(/unsafe-native.*nativeAbortQuarantine.*confirmed-stop/);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a native adapter that launches without its declared stop barrier", async () => {
    const run = vi.fn(() => new Promise<AgentHarnessResult>(() => {}));
    const { harness } = harnessStub("unregistered-native-stop", []);
    const unregisteredHarness: AgentHarness = {
      ...harness,
      toolControl: "native",
      nativeAbortQuarantine: "confirmed-stop",
      run,
    };

    await expect(
      runAgentHarness(unregisteredHarness, {
        prompt: "x",
        effort: "xhigh",
        abortController: new AbortController(),
      }),
    ).rejects.toThrow(/unregistered-native-stop.*without registering/);
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([
    { terminal: "success", run: async () => ({ text: "ok", streamedText: "ok", turns: 1, isError: false }) },
    { terminal: "failure", run: async () => { throw new Error("adapter failed"); } },
  ])("removes its cancellation listener after adapter $terminal", async ({ run }) => {
    const abortController = new AbortController();
    const addListener = vi.spyOn(abortController.signal, "addEventListener");
    const removeListener = vi.spyOn(abortController.signal, "removeEventListener");
    const { harness } = harnessStub(`terminal-${Math.random()}`, []);
    harness.run = run;

    await runAgentHarness(harness, {
      prompt: "x",
      effort: "xhigh",
      abortController,
    }).catch(() => undefined);

    const abortListener = addListener.mock.calls.find(([event]) => event === "abort")?.[1];
    expect(abortListener).toBeDefined();
    expect(removeListener).toHaveBeenCalledWith("abort", abortListener);
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
