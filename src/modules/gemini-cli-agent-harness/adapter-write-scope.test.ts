import { beforeEach, describe, expect, it, vi } from "vitest";

const collectTextFromGeminiCliMock = vi.hoisted(() => vi.fn());

vi.mock("./cli-runner.js", () => ({
  collectTextFromGeminiCli: collectTextFromGeminiCliMock,
}));

import { geminiCliAgentHarness } from "./adapter.js";

describe("gemini CLI agent write scope", () => {
  beforeEach(() => {
    collectTextFromGeminiCliMock.mockReset().mockResolvedValue({
      text: "done",
      streamedText: "done",
      turns: 1,
      isError: false,
    });
  });

  it("projects the agent-owned root into both native write boundaries", async () => {
    await geminiCliAgentHarness.run({
      prompt: "review evidence",
      model: "gemini-2.5-pro",
      effort: "xhigh",
      cwd: "/repo",
      agentWriteScope: ["data/tasks/"],
      agentOutputDir: "/repo/.kota/runs/run-1/agent-output",
    });

    expect(collectTextFromGeminiCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        approvalMode: "auto_edit",
        writableRoots: [
          "/repo/data/tasks",
          "/repo/.kota/runs/run-1/agent-output",
        ],
        runtimeWritableRoots: [
          "/repo/data/tasks",
          "/repo/.kota/runs/run-1/agent-output",
        ],
      }),
    );
  });
});
