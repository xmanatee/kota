import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCanUseTool } from "#core/agent-harness/index.js";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";

const executeWithAgentSDKMock = vi.fn();

vi.mock("./executor.js", async (importActual) => {
  const actual = await importActual<typeof import("./executor.js")>();
  return {
    ...actual,
    executeWithAgentSDK: (...args: unknown[]) =>
      executeWithAgentSDKMock(...args),
  };
});

import { claudeAgentHarness } from "./adapter.js";

describe("claudeAgentHarness", () => {
  beforeEach(() => {
    executeWithAgentSDKMock.mockReset();
    executeWithAgentSDKMock.mockResolvedValue({
      text: "hello",
      streamedText: "hello",
      turns: 1,
      isError: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the prompt and options through to executeWithAgentSDK", async () => {
    const abortController = new AbortController();
    const writer = { write: () => true };
    const result = await claudeAgentHarness.run(
      {
        prompt: "task body",
        model: "claude-sonnet-4-6",
        cwd: "/tmp/project",
        effort: "xhigh",
        abortController,
      },
      writer,
    );

    expect(result).toEqual({
      text: "hello",
      streamedText: "hello",
      turns: 1,
      isError: false,
    });
    expect(executeWithAgentSDKMock).toHaveBeenCalledTimes(1);
    const [prompt, options, passedWriter] = executeWithAgentSDKMock.mock.calls[0];
    expect(prompt).toBe("task body");
    expect(options).toMatchObject({
      model: "claude-sonnet-4-6",
      cwd: "/tmp/project",
      effort: "xhigh",
    });
    expect(options.abortController).toBe(abortController);
    expect(passedWriter).toBe(writer);
  });

  it("declares its name so the registry can resolve it", () => {
    expect(claudeAgentHarness.name).toBe("claude-agent-sdk");
    expect(claudeAgentHarness.unsupportedRunOptions).toEqual([
      expect.objectContaining({
        option: 'autonomyMode="supervised"',
        runOption: "autonomyMode.supervised",
      }),
    ]);
  });

  it("routes live autonomy restrictions through the SDK permission callback", async () => {
    const scopePolicy = resolveScopePolicy({
      projection: {
        rootScopeId: "global",
        defaultScopeId: "workspace",
        scopes: [
          { scopeId: "global", displayName: "Global" },
          {
            scopeId: "workspace",
            displayName: "Workspace",
            parentScopeId: "global",
            directoryRoot: "/tmp/workspace",
          },
        ],
      },
      scopeId: "workspace",
    });
    const passivePolicy = resolveScopePolicy({
      projection: {
        rootScopeId: "global",
        defaultScopeId: "workspace",
        scopes: [
          { scopeId: "global", displayName: "Global" },
          {
            scopeId: "workspace",
            displayName: "Workspace",
            parentScopeId: "global",
            directoryRoot: "/tmp/workspace",
          },
        ],
      },
      scopeId: "workspace",
      fragments: [{
        scopeId: "workspace",
        reason: "Autonomous writes were revoked.",
        autonomy: { defaultMode: "passive", maxMode: "passive" },
      }],
    });
    let snapshot = { revision: 0, policy: scopePolicy };
    const getScopePolicySnapshot = vi.fn(() => snapshot);

    await claudeAgentHarness.run({
      prompt: "task body",
      effort: "xhigh",
      cwd: "/tmp/workspace",
      autonomyMode: "autonomous",
      scopePolicy,
      getScopePolicySnapshot,
    });

    const sdkOptions = executeWithAgentSDKMock.mock.calls[0]?.[1] as {
      canUseTool?: AgentCanUseTool;
    };
    await expect(
      sdkOptions.canUseTool?.("Write", { file_path: "/tmp/workspace/out.ts" }, {
        signal: new AbortController().signal,
        toolUseId: "write-before-restriction",
      }),
    ).resolves.toMatchObject({ behavior: "allow" });
    snapshot = { revision: 1, policy: passivePolicy };
    await expect(
      sdkOptions.canUseTool?.("Write", { file_path: "/tmp/workspace/out.ts" }, {
        signal: new AbortController().signal,
        toolUseId: "write-after-restriction",
      }),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining('autonomy mode "passive"'),
    });
    expect(getScopePolicySnapshot).toHaveBeenCalledTimes(2);
  });
});
