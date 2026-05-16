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
