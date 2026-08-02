import "./executor-test-support.js";
import { describe, expect, it, vi } from "vitest";
import {
  createDaemonHostControlGuard,
  isDaemonHostControlCommand,
} from "#core/agent-harness/guards.js";
import {
  detectLocalClaudeCodeExecutable,
  executeWithAgentSDK,
} from "./executor.js";
import {
  makeIterable,
  makeWriter,
  mockQuery,
  mockSpawnSync,
} from "./executor-test-support.js";

describe("agent-sdk executor", () => {
  it("streams assistant text and returns final result metadata", async () => {
    mockQuery.mockReturnValue(
      makeIterable([
        { type: "system", subtype: "init", session_id: "sess-123" },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello " }] },
        },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "world" }] },
        },
        {
          type: "result",
          result: "Final answer",
          num_turns: 2,
          total_cost_usd: 0.12,
          subtype: "success",
        },
      ]),
    );

    const writer = makeWriter();
    const result = await executeWithAgentSDK("test prompt", { effort: "xhigh" }, writer);

    expect(writer.text).toBe("Hello world");
    expect(result.text).toBe("Final answer");
    expect(result.streamedText).toBe("Hello world");
    expect(result.sessionId).toBe("sess-123");
    expect(result.turns).toBe(2);
    expect(result.totalCostUsd).toBe(0.12);
    expect(result.subtype).toBe("success");
    expect(result.isError).toBe(false);
  });

  it("supports top-level content blocks when present", async () => {
    mockQuery.mockReturnValue(
      makeIterable([
        {
          type: "assistant",
          content: [
            { type: "text", text: "one " },
            { type: "tool_use" },
            { type: "text", text: "two" },
          ],
        },
      ]),
    );

    const writer = makeWriter();
    const result = await executeWithAgentSDK("test prompt", { effort: "xhigh" }, writer);

    expect(writer.text).toBe("one two");
    expect(result.text).toBe("one two");
    expect(result.turns).toBe(1);
    expect(result.isError).toBe(false);
  });

  it("marks error result subtypes as errors", async () => {
    mockQuery.mockReturnValue(
      makeIterable([
        {
          type: "result",
          result: "Stopped at turn limit",
          subtype: "error_max_turns",
          is_error: true,
        },
      ]),
    );

    const result = await executeWithAgentSDK("test prompt", { effort: "xhigh" }, makeWriter());

    expect(result.subtype).toBe("error_max_turns");
    expect(result.isError).toBe(true);
  });

  it("passes strict SDK options through to query()", async () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "/usr/local/bin/claude\n" });
    mockQuery.mockReturnValue(
      makeIterable([{ type: "result", result: "done", subtype: "success" }]),
    );

    await executeWithAgentSDK("my task", {
      model: "claude-sonnet-4-6",
      cwd: "/tmp/project",
      maxTurns: 12,
      effort: "xhigh",
      systemPrompt: "portable system text",
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Edit"],
      disallowedTools: ["Bash"],
      persistSession: false,
      settingSources: ["project"],
      enableFileCheckpointing: true,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "my task",
      options: {
        model: "claude-sonnet-4-6",
        cwd: "/tmp/project",
        maxTurns: 12,
        systemPrompt: "portable system text",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: ["Read", "Edit"],
        disallowedTools: ["Bash"],
        mcpServers: undefined,
        persistSession: false,
        settingSources: ["project"],
        enableFileCheckpointing: true,
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        abortController: undefined,
        effort: "xhigh",
        thinking: undefined,
        spawnClaudeCodeProcess: expect.any(Function),
        canUseTool: undefined,
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          allowUnsandboxedCommands: false,
          autoAllowBashIfSandboxed: true,
          filesystem: {
            allowWrite: ["/tmp/project"],
            denyWrite: expect.arrayContaining([
              expect.stringMatching(/\.kota$/),
              expect.stringMatching(/scope-authority-token\.json$/),
            ]),
            denyRead: expect.arrayContaining([
              expect.stringMatching(/scope-authority-token\.json$/),
            ]),
          },
        },
      },
    });
  });

  it("identifies daemon-host control commands", () => {
    expect(isDaemonHostControlCommand("pnpm kota daemon stop", 7315)).toBe(true);
    expect(isDaemonHostControlCommand("node dist/cli.js daemon", 7315)).toBe(true);
    expect(isDaemonHostControlCommand("kill -TERM 7315", 7315)).toBe(true);
    expect(isDaemonHostControlCommand("kill -s TERM 7315", 7315)).toBe(true);
    expect(isDaemonHostControlCommand("pnpm kota workflow abort", 7315)).toBe(true);
    expect(isDaemonHostControlCommand("pnpm kota task move example done", 7315)).toBe(false);
    expect(isDaemonHostControlCommand("pnpm build", 7315)).toBe(false);
  });

  it("denies Bash daemon-host control commands through SDK permissions", async () => {
    const guard = createDaemonHostControlGuard(7315);
    const options = { signal: new AbortController().signal, toolUseId: "tool-1" };

    await expect(
      guard("Read", { file_path: "src/index.ts" }, options),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { file_path: "src/index.ts" },
    });
    await expect(
      guard("Bash", { command: "pnpm kota task move example done" }, options),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "pnpm kota task move example done" },
    });
    const denied = await guard(
      "Bash",
      { command: "pnpm kota daemon stop" },
      options,
    );
    expect(denied).toMatchObject({ behavior: "deny" });
    expect(denied).not.toHaveProperty("interrupt");
  });

  it("detects a locally installed claude executable", () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0,
      stdout: "/Users/test/.local/bin/claude\n",
    });

    expect(detectLocalClaudeCodeExecutable()).toBe(
      "/Users/test/.local/bin/claude",
    );
  });

  it("prefers CLAUDE_CODE_EXECUTABLE over PATH lookup", () => {
    process.env.CLAUDE_CODE_EXECUTABLE = "/custom/claude";

    expect(detectLocalClaudeCodeExecutable()).toBe("/custom/claude");
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("writes verbose status messages to stderr", async () => {
    mockQuery.mockReturnValue(
      makeIterable([
        {
          type: "system",
          subtype: "task_started",
          description: "Running tests",
        },
        { type: "result", result: "done", subtype: "success" },
      ]),
    );

    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await executeWithAgentSDK("task", { verbose: true, effort: "xhigh" }, makeWriter());

    expect(stderrSpy).toHaveBeenCalledWith("[agent-sdk] Running tests\n");
    stderrSpy.mockRestore();
  });

});
