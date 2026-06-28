import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KotaContentBlock, KotaToolResultBlock } from "#core/agent-harness/index.js";
import { runScenarioOnHarness } from "./runner.js";
import { cleanupRunnerTestState, makeHarness, setupRunnerTestState } from "./runner.test-support.js";
import { loadScenario } from "./scenario.js";

describe("harness-parity runner trajectory truncation", () => {
let scenariosRoot: string;
let outRoot: string;

beforeEach(() => {
  ({ scenariosRoot, outRoot } = setupRunnerTestState());
});

afterEach(() => {
  cleanupRunnerTestState({ scenariosRoot, outRoot });
});

  it("truncates oversized tool-result content in trajectory artifacts", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const oversized = "x".repeat(20_000);
    const harness = makeHarness(
      "streaming-large-result",
      async (workingDir, options) => {
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "tool-large",
          toolName: "Read",
          input: { path: "large.txt" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "tool-large",
          isError: false,
          content: oversized,
        });
      },
      {},
      { emitsAgentMessageStream: true },
    );

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const trajectory = JSON.parse(
      readFileSync(join(artifact.artifactDir, "trajectory.json"), "utf-8"),
    );
    const resultFrame = trajectory.frames[1];
    expect(resultFrame).toMatchObject({
      index: 1,
      type: "tool_result",
      toolName: "Read",
      truncatedFields: ["content"],
      message: {
        type: "tool_result",
        toolUseId: "tool-large",
        isError: false,
      },
    });
    expect(resultFrame.message.content.length).toBeLessThan(oversized.length);
    expect(resultFrame.message.content).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );
    expect(trajectory.counts.truncatedFrameCount).toBe(1);

    const summary = readFileSync(
      join(artifact.artifactDir, "trajectory-summary.md"),
      "utf-8",
    );
    expect(summary).toContain("truncated=content");
  });

  it("truncates rich tool-result block payloads in trajectory artifacts", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const oversized = "x".repeat(20_000);
    const nestedToolResult: KotaToolResultBlock = {
      type: "tool_result",
      tool_use_id: "nested-tool",
      is_error: false,
      content: [
        { type: "text", text: oversized },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: oversized,
          },
        },
        {
          type: "mcp_content",
          content: {
            type: "resource",
            resource: {
              uri: "file:///report.txt",
              mimeType: "text/plain",
              text: oversized,
            },
          },
        },
        {
          type: "mcp_content",
          content: {
            type: "resource",
            resource: {
              uri: "file:///report.bin",
              mimeType: "application/octet-stream",
              blob: oversized,
            },
          },
        },
        {
          type: "mcp_content",
          content: {
            type: "audio",
            mimeType: "audio/wav",
            data: oversized,
          },
        },
      ],
      structuredContent: {
        raw: oversized,
      },
    };
    const stringNestedToolResult: KotaToolResultBlock = {
      type: "tool_result",
      tool_use_id: "nested-string-tool",
      is_error: false,
      content: oversized,
      structuredContent: {
        raw: oversized,
      },
      _meta: {
        raw: oversized,
      },
    };
    const richContent: KotaContentBlock[] = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: oversized,
        },
      },
      nestedToolResult,
      stringNestedToolResult,
    ];
    const harness = makeHarness(
      "streaming-rich-result",
      async (workingDir, options) => {
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "tool-rich",
          toolName: "Inspect",
          input: { path: "rich.bin" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "tool-rich",
          isError: false,
          content: richContent,
        });
      },
      {},
      { emitsAgentMessageStream: true },
    );

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const trajectory = JSON.parse(
      readFileSync(join(artifact.artifactDir, "trajectory.json"), "utf-8"),
    );
    const resultFrame = trajectory.frames[1];
    expect(resultFrame.truncatedFields).toEqual([
      "content[0].source.data",
      "content[1].content[0].text",
      "content[1].content[1].source.data",
      "content[1].content[2].content.resource.text",
      "content[1].content[3].content.resource.blob",
      "content[1].content[4].content.data",
      "content[1].structuredContent.raw",
      "content[2].content",
      "content[2].structuredContent.raw",
      "content[2]._meta.raw",
    ]);
    expect(resultFrame.message.content[0].source.data).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );
    expect(resultFrame.message.content[1].content[0].text).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );
    expect(resultFrame.message.content[1].content[1].source.data).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );
    expect(resultFrame.message.content[1].content[2].content.resource.text).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );
    expect(resultFrame.message.content[1].content[3].content.resource.blob).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );
    expect(resultFrame.message.content[1].content[4].content.data).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );
    expect(resultFrame.message.content[1].structuredContent.raw).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );
    expect(resultFrame.message.content[2].content).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );
    expect(resultFrame.message.content[2].structuredContent.raw).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );
    expect(resultFrame.message.content[2]._meta.raw).toContain(
      "[... 12000 chars truncated from trajectory field ...]",
    );

    const summary = readFileSync(
      join(artifact.artifactDir, "trajectory-summary.md"),
      "utf-8",
    );
    expect(summary).toContain(
      "truncated=content[0].source.data,content[1].content[0].text",
    );
  });
});
