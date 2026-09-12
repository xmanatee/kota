import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import {
  registerHarnessHook,
  resetHarnessHooks,
} from "./hooks.js";
import type { AgentHarnessUnsupportedRunOption } from "./readiness.js";
import {
  routeKotaToolControlOptions,
  runAgentHarness,
  shouldRouteKotaToolControl,
} from "./runner.js";
import { harnessStub } from "./runner-fixtures.integration.js";
import type { AgentHarness, AgentHarnessRunOptions } from "./types.js";

describe("runAgentHarness", () => {
  let scopeRoot: string;
  beforeEach(() => { scopeRoot = mkdtempSync(join(tmpdir(), "kota-runner-")); });
  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
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
      scopeRoot, prompt: "hello",
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

  it("rejects the call if a hook kind is registered for an adapter that does not host it", async () => {
    registerHarnessHook({
      kind: "preRun",
      owner: "observer",
      name: "unhosted",
      handler: () => {},
    });

    const { harness, run } = harnessStub("no-hooks", []);

    await expect(
      runAgentHarness(harness, { scopeRoot, prompt: "x", effort: "xhigh" }),
    ).rejects.toThrow(/"no-hooks".*"preRun".*Remove the hook/);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the adapter without hooks when none are registered", async () => {
    const { harness, run } = harnessStub("alpha", ["preRun", "postRun"]);
    await runAgentHarness(harness, { scopeRoot, prompt: "hello", effort: "xhigh" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each<{
    runOption: AgentHarnessUnsupportedRunOption;
    requested: Partial<AgentHarnessRunOptions>;
    absent: Partial<AgentHarnessRunOptions>;
  }>([
    { runOption: "canUseTool", requested: { canUseTool: async () => ({ behavior: "allow" }) }, absent: {} },
    { runOption: "maxTurns", requested: { maxTurns: 0 }, absent: {} },
    { runOption: "autonomyMode.passive", requested: { autonomyMode: "passive" }, absent: { autonomyMode: "autonomous" } },
    { runOption: "allowedTools", requested: { allowedTools: ["Read"] }, absent: { allowedTools: [] } },
    { runOption: "persistSession", requested: { persistSession: true }, absent: { persistSession: false } },
  ])("rejects requested $runOption before hooks, but admits its absent form", async ({ runOption, requested, absent }) => {
    const preRun = vi.fn();
    registerHarnessHook({ kind: "preRun", owner: "observer", name: "before", handler: preRun });
    const { harness, run } = harnessStub("limited", ["preRun", "postRun"]);
    const limitedHarness: AgentHarness = {
      ...harness, unsupportedRunOptions: [{ runOption, option: runOption, reason: "capability unavailable" }],
    };

    await expect(runAgentHarness(limitedHarness, {
      scopeRoot, prompt: "x", effort: "xhigh", ...requested,
    })).rejects.toThrow(`cannot honor requested run option(s): ${runOption}`);
    expect(preRun).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();

    await expect(runAgentHarness(limitedHarness, {
      scopeRoot, prompt: "x", effort: "xhigh", ...absent,
    })).resolves.toMatchObject({ text: "limited-ok" });
    expect(preRun).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects live scope-policy authority at a native adapter boundary", async () => {
    const { harness, run } = harnessStub("native-authority", []);
    const nativeHarness: AgentHarness = { ...harness, toolControl: "native" };
    const scopePolicyAuthority = {
      getSnapshot: vi.fn(),
      subscribeRestrictiveChanges: vi.fn(),
    } as NonNullable<AgentHarnessRunOptions["scopePolicyAuthority"]>;

    await expect(
      runAgentHarness(nativeHarness, {
        scopeRoot, prompt: "x",
        effort: "xhigh",
        scopePolicyAuthority,
      }),
    ).rejects.toThrow(/native-authority.*cannot receive.*scope-policy authority/);
    expect(run).not.toHaveBeenCalled();
  });

  it("routes KOTA tool control only to hosted loops but preserves scope policy for native preflight", () => {
    const { harness } = harnessStub("tool-loop", ["preRun", "postRun"]);
    const scopePolicyAuthority = {
      getSnapshot: vi.fn(),
      subscribeRestrictiveChanges: vi.fn(),
    } as NonNullable<AgentHarnessRunOptions["scopePolicyAuthority"]>;
    const scopePolicy = resolveScopePolicy({
      projection: {
        rootScopeId: "global",
        defaultScopeId: "global",
        scopes: [{ scopeId: "global", displayName: "Global" }],
      },
      scopeId: "global",
    });

    expect(shouldRouteKotaToolControl(harness)).toBe(true);
    expect(shouldRouteKotaToolControl({ ...harness, toolControl: "native" })).toBe(false);
    expect(
      routeKotaToolControlOptions(harness, {
        allowedTools: ["Read"],
        scopePolicyAuthority,
      }),
    ).toEqual({ allowedTools: ["Read"], scopePolicyAuthority });
    expect(
      routeKotaToolControlOptions(
        { ...harness, toolControl: "native" },
        {
          allowedTools: ["Read"],
          canUseTool: async () => ({ behavior: "allow" }),
          scopePolicy,
          scopePolicyAuthority,
        },
      ),
    ).toEqual({ scopePolicy });
  });
});
