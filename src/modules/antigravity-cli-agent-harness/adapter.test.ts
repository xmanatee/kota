import { describe, expect, it, vi } from "vitest";
import {
  ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
  antigravityCliAgentHarness,
} from "./adapter.js";

describe("antigravityCliAgentHarness", () => {
  it("registers as the native Antigravity CLI readiness harness", () => {
    expect(antigravityCliAgentHarness.name).toBe(
      ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
    );
    expect(antigravityCliAgentHarness.name).toBe("antigravity-cli");
    expect(antigravityCliAgentHarness.supportsMultiTurn).toBe(false);
    expect(antigravityCliAgentHarness.askOwnerToolName).toBeNull();
    expect(antigravityCliAgentHarness.emitsAgentMessageStream).toBe(false);
    expect(antigravityCliAgentHarness.toolControl).toBe("native");
    expect(
      antigravityCliAgentHarness.unsupportedRunOptions?.map((option) => option.option),
    ).toEqual(
      expect.arrayContaining([
        "allowedTools",
        "disallowedTools",
        "canUseTool",
        "askOwner",
        "mcpServers",
      ]),
    );
  });

  it("reports AGY runtime and explicit non-interactive auth boundary in readiness", () => {
    const readiness = antigravityCliAgentHarness.readiness?.();

    expect(readiness).toMatchObject({
      adapterKind: "native-cli",
      localRuntime: {
        kind: "native-cli",
        command: "agy --version",
        binaryName: "agy",
        required: true,
      },
      localAuth: {
        kind: "harness-managed-login",
        status: "missing",
        command: "agy",
        required: true,
      },
    });
    expect(readiness?.localAuth?.summary).toContain(
      "cannot be verified non-interactively",
    );
    expect(readiness?.localAuth?.detail).toContain(
      ".gemini/antigravity-cli/settings.json",
    );
  });

  it("returns a typed unsupported result instead of scraping the AGY terminal UI", async () => {
    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await antigravityCliAgentHarness.run(
      {
        prompt: "please work",
        model: "gemini-3.5-flash",
        effort: "xhigh",
      },
      writer,
    );

    expect(writer.write).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      streamedText: "",
      turns: 0,
      isError: true,
      subtype: "antigravity_cli_headless_unsupported",
    });
    expect(result.text).toContain("no stable non-interactive structured-output command");
  });

  it("returns an aborted result when the caller aborts before execution", async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.5-flash",
        effort: "xhigh",
        abortController,
      }),
    ).resolves.toMatchObject({
      text: "Antigravity CLI run aborted.",
      isError: true,
      subtype: "aborted",
    });
  });

  it("requires an explicit model even though execution is unsupported", async () => {
    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        effort: "xhigh",
      }),
    ).rejects.toThrow(/requires an explicit model/);
  });

  it("rejects unsupported KOTA-owned tool-control surfaces loudly", async () => {
    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.5-flash",
        effort: "xhigh",
        canUseTool: async () => ({ behavior: "allow" }),
      }),
    ).rejects.toThrow(/canUseTool/);

    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.5-flash",
        effort: "xhigh",
        mcpServers: { foo: { type: "stdio", command: "bar" } },
      }),
    ).rejects.toThrow(/does not host KOTA MCP servers/);

    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.5-flash",
        effort: "xhigh",
        askOwner: { source: "test" },
      }),
    ).rejects.toThrow(/ask_owner/);
  });
});
