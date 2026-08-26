import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScenarioAcrossHarnesses } from "./runner.js";
import { cleanupRunnerTestState, makeHarness, setupRunnerTestState } from "./runner.test-support.js";
import { loadScenario } from "./scenario.js";

describe("harness-parity runner trajectory stream artifacts", () => {
let scenariosRoot: string;
let outRoot: string;

beforeEach(() => {
  ({ scenariosRoot, outRoot } = setupRunnerTestState());
});

afterEach(() => {
  cleanupRunnerTestState({ scenariosRoot, outRoot });
});

  it("captures ordered structured trajectories for message-streaming harnesses", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const harness = makeHarness(
      "streaming",
      async (workingDir, options) => {
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
        await options.onMessage?.({
          type: "status",
          category: "started",
          text: "run started",
        });
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "tool-1",
          toolName: "Edit",
          input: { path: "add.js" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "tool-1",
          isError: false,
          content: "patched add.js",
        });
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "tool-2",
          toolName: "Bash",
          input: { command: "pnpm test add.test.ts" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "tool-2",
          isError: false,
          content: "tests passed",
        });
        await options.onMessage?.({
          type: "result",
          text: "done",
          isError: false,
          numTurns: 1,
          usage: {
            tokens: { state: "complete", inputTokens: 3, outputTokens: 1 },
            cost: { state: "unknown" },
          },
        });
      },
      {},
      { emitsAgentMessageStream: true },
    );

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [harness],
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const trajectory = JSON.parse(
      readFileSync(join(artifacts[0]!.artifactDir, "trajectory.json"), "utf-8"),
    );
    expect(trajectory.status).toBe("supported");
    expect(trajectory.counts).toMatchObject({
      frameCount: 6,
      toolCallCount: 2,
      toolResultCount: 2,
      statusCount: 1,
      resultCount: 1,
      truncatedFrameCount: 0,
    });
    expect(trajectory.frames.map((frame: { type: string }) => frame.type)).toEqual([
      "status",
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
      "result",
    ]);
    expect(trajectory.frames[1]).toMatchObject({
      index: 1,
      toolName: "Edit",
      message: {
        type: "tool_call",
        toolUseId: "tool-1",
        toolName: "Edit",
      },
    });
    expect(trajectory.frames[2]).toMatchObject({
      index: 2,
      toolName: "Edit",
      message: {
        type: "tool_result",
        toolUseId: "tool-1",
        isError: false,
      },
    });
    expect(trajectory.frames[3]).toMatchObject({
      index: 3,
      toolName: "Bash",
      message: {
        type: "tool_call",
        toolUseId: "tool-2",
        toolName: "Bash",
      },
    });
    expect(trajectory.frames[5]).toMatchObject({
      message: {
        type: "result",
        isError: false,
        numTurns: 1,
        usage: {
          tokens: { state: "complete", inputTokens: 3, outputTokens: 1 },
          cost: { state: "unknown" },
        },
      },
    });

    const summary = readFileSync(
      join(artifacts[0]!.artifactDir, "trajectory-summary.md"),
      "utf-8",
    );
    expect(summary).toContain("tool_call Edit (tool-1)");
    expect(summary).toContain("tool_result Edit (tool-1) isError=false");
    expect(summary).toContain("- diagnosticWarnings: 0");

    const diagnostics = JSON.parse(
      readFileSync(
        join(artifacts[0]!.artifactDir, "trajectory-diagnostics.json"),
        "utf-8",
      ),
    );
    expect(diagnostics).toMatchObject({
      status: "supported",
      emitsAgentMessageStream: true,
      counts: {
        warningCount: 0,
      },
      diagnostics: [],
    });

    const parity = JSON.parse(
      readFileSync(join(outRoot, "fix-add", "parity.json"), "utf-8"),
    );
    expect(parity.artifacts[0].trajectory).toMatchObject({
      status: "supported",
      emitsAgentMessageStream: true,
      frameCount: 6,
      toolCallCount: 2,
      toolResultCount: 2,
      resultCount: 1,
      artifactPath: join(artifacts[0]!.artifactDir, "trajectory.json"),
      summaryPath: join(artifacts[0]!.artifactDir, "trajectory-summary.md"),
    });
    expect(parity.artifacts[0].trajectoryDiagnostics).toMatchObject({
      warningCount: 0,
      artifactPath: join(
        artifacts[0]!.artifactDir,
        "trajectory-diagnostics.json",
      ),
    });
  });

  it("writes explicit unsupported trajectory artifacts for non-streaming harnesses", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const harness = makeHarness("non-streaming", (workingDir) => {
      writeFileSync(
        join(workingDir, "add.js"),
        "exports.add = (a, b) => a + b;\n",
      );
    });

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [harness],
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const trajectory = JSON.parse(
      readFileSync(join(artifacts[0]!.artifactDir, "trajectory.json"), "utf-8"),
    );
    expect(trajectory).toMatchObject({
      status: "unsupported",
      emitsAgentMessageStream: false,
      reason:
        "Harness capability snapshot declares emitsAgentMessageStream=false.",
      frames: [],
      counts: {
        frameCount: 0,
        toolCallCount: 0,
        toolResultCount: 0,
        statusCount: 0,
        resultCount: 0,
        truncatedFrameCount: 0,
      },
    });
    const summary = readFileSync(
      join(artifacts[0]!.artifactDir, "trajectory-summary.md"),
      "utf-8",
    );
    expect(summary).toContain("- status: unsupported");
    expect(summary).toContain(
      "- reason: Harness capability snapshot declares emitsAgentMessageStream=false.",
    );
    expect(summary).toContain("- diagnosticWarnings: 1");

    const diagnostics = JSON.parse(
      readFileSync(
        join(artifacts[0]!.artifactDir, "trajectory-diagnostics.json"),
        "utf-8",
      ),
    );
    expect(diagnostics).toMatchObject({
      status: "unsupported",
      emitsAgentMessageStream: false,
      counts: {
        warningCount: 1,
        unsupportedTrajectoryCount: 1,
      },
      diagnostics: [
        {
          code: "unsupported_trajectory",
          frameIndexes: [],
        },
      ],
    });

    const parity = JSON.parse(
      readFileSync(join(outRoot, "fix-add", "parity.json"), "utf-8"),
    );
    expect(parity.artifacts[0].trajectory).toMatchObject({
      status: "unsupported",
      emitsAgentMessageStream: false,
      reason:
        "Harness capability snapshot declares emitsAgentMessageStream=false.",
      frameCount: 0,
      artifactPath: join(artifacts[0]!.artifactDir, "trajectory.json"),
    });
    expect(parity.artifacts[0].trajectoryDiagnostics).toMatchObject({
      warningCount: 1,
      unsupportedTrajectoryCount: 1,
      artifactPath: join(
        artifacts[0]!.artifactDir,
        "trajectory-diagnostics.json",
      ),
    });
  });
});
