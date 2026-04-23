import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  });
});
