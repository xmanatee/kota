import { afterEach, describe, expect, it, vi } from "vitest";
import { resetHarnessHooks } from "./hooks.js";
import { runAgentHarness } from "./runner.js";
import { harnessStub } from "./runner-fixtures.integration.js";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
} from "./types.js";
import { AgentUsageAccumulator, UNKNOWN_AGENT_USAGE } from "./usage.js";

describe("runAgentHarness cancellation", () => {
  afterEach(() => {
    resetHarnessHooks();
    vi.restoreAllMocks();
  });

  it("quarantines callbacks, writer output, and success returned after cancellation", async () => {
    const abortController = new AbortController();
    const abortReason = new Error("scope authority revision became restrictive");
    const acceptedMessages = vi.fn();
    const observedUsage = vi.fn();
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
          usage: {
            tokens: { state: "complete", inputTokens: 100, outputTokens: 10 },
            cost: { state: "complete", usd: 1 },
          },
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
        onUsage: observedUsage,
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
    expect(observedUsage).toHaveBeenCalledOnce();
    expect(observedUsage).toHaveBeenCalledWith({
      tokens: { state: "unknown" },
      cost: { state: "unknown" },
    });
  });

  it("retains usage observed before native quarantine while rejecting the cancelled result", async () => {
    const abortController = new AbortController();
    const usage = new AgentUsageAccumulator();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release = () => {};
    const stopped = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness: AgentHarness = {
      name: "usage-native",
      description: "reports terminal provider usage before cancellation",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "native",
      nativeAbortQuarantine: "confirmed-stop",
      async run(options) {
        options.abortQuarantine?.register(async () => {
          release();
          await stopped;
        });
        options.onUsage?.({
          tokens: { state: "complete", inputTokens: 18, outputTokens: 7 },
          cost: { state: "unavailable", reason: "provider-does-not-report" },
        });
        markStarted();
        await stopped;
        return {
          text: "stale success",
          streamedText: "",
          turns: 1,
          usage: {
            tokens: { state: "complete", inputTokens: 18, outputTokens: 7 },
            cost: { state: "unavailable", reason: "provider-does-not-report" },
          },
          isError: false,
        };
      },
    };

    const run = runAgentHarness(harness, {
      prompt: "x",
      effort: "xhigh",
      abortController,
      onUsage: usage.observe,
    });
    await started;
    abortController.abort(new Error("cancelled"));

    await expect(run).rejects.toThrow("cancelled");
    expect(usage.snapshot()).toEqual({
      tokens: { state: "complete", inputTokens: 18, outputTokens: 7 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });
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

  it("activates native quarantine when a caller supplies a child AbortController", async () => {
    const abortController = new AbortController();
    const register = vi.fn();
    const { harness } = harnessStub("delegate-child", []);
    const nativeHarness: AgentHarness = {
      ...harness,
      toolControl: "native",
      nativeAbortQuarantine: "confirmed-stop",
      run: async (options) => {
        expect(options.abortController).toBe(abortController);
        expect(options.abortQuarantine).toBeDefined();
        options.abortQuarantine?.register(register);
        return {
          text: "ok",
          streamedText: "ok",
          turns: 1,
          usage: UNKNOWN_AGENT_USAGE,
          isError: false,
        };
      },
    };

    await expect(
      runAgentHarness(nativeHarness, {
        prompt: "x",
        effort: "xhigh",
        abortController,
      }),
    ).resolves.toMatchObject({ text: "ok" });
    expect(register).not.toHaveBeenCalled();
  });

  it.each([
    {
      terminal: "success",
      run: async () => ({
        text: "ok",
        streamedText: "ok",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
        isError: false,
      }),
    },
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
});
