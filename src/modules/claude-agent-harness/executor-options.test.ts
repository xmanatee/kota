import "./executor-test-support.js";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { composeCanUseTools } from "#core/agent-harness/index.js";
import {
  buildQueryOptions,
  executeWithAgentSDK,
  normalizePermissionResult,
  SDK_ABORT_FORCE_KILL_MS,
  spawnClaudeCodeProcessWithAbortKill,
} from "./executor.js";
import {
  makeIterable,
  makeWriter,
  mockQuery,
  mockSpawn,
  mockSpawnSync,
  type RawSdkTestMessage,
} from "./executor-test-support.js";
import {
  createClaudeAgentReadScopeGuard,
  createClaudeAgentWriteScopeGuard,
} from "./scope-policy-guard.js";

describe("agent-sdk executor options and lifecycle", () => {
  it("keeps SDK permission callbacks enabled for protected session storage", () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });

    expect(buildQueryOptions({ cwd: "/tmp/project", effort: "xhigh" })).toMatchObject({
      cwd: "/tmp/project",
      maxTurns: undefined,
      permissionMode: "default",
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: undefined,
    });
  });

  it("enforces a fail-closed sandbox around a custom authority document", () => {
    const options = buildQueryOptions({
      cwd: "/tmp/project",
      authorityConfigPath: "/operator/machine/config.json",
      effort: "xhigh",
    });

    expect(options.sandbox).toEqual({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      filesystem: {
        allowWrite: ["/tmp/project"],
        denyWrite: expect.arrayContaining([
          "/operator/machine",
          "/operator/machine/scope-authority-token.json",
        ]),
        denyRead: expect.arrayContaining([
          "/operator/machine/scope-authority-token.json",
        ]),
      },
    });
  });

  it("scopes the agent-owned write scope into the SDK sandbox allowlist", () => {
    const options = buildQueryOptions({
      cwd: "/tmp/project",
      agentWriteScope: ["data/tasks/"],
      agentOutputDir: "/tmp/project/.kota/runs/run-1/agent-output",
      effort: "xhigh",
    });

    expect(options.sandbox?.filesystem?.allowWrite).toEqual([
      "/tmp/project/data/tasks",
      "/tmp/project/.kota/runs/run-1/agent-output",
    ]);
    expect(options.sandbox?.filesystem?.allowWrite).not.toContain(
      "/tmp/project/.kota/runs",
    );
    expect(options.sandbox?.filesystem?.allowWrite).not.toContain(
      "/tmp/project",
    );
  });

  it("denies native reads of an environment-selected arbitrary token filename", () => {
    const priorTokenPath = process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
    const tokenPath = "/operator/credentials/machine-proof.dat";
    process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = tokenPath;
    try {
      const options = buildQueryOptions({
        cwd: "/tmp/project",
        authorityConfigPath: "/operator/machine/config.json",
        effort: "xhigh",
      });

      expect(options.sandbox?.filesystem?.denyRead).toContain(tokenPath);
      expect(options.sandbox?.filesystem?.denyWrite).toContain(tokenPath);
    } finally {
      if (priorTokenPath === undefined) {
        delete process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
      } else {
        process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = priorTokenPath;
      }
    }
  });

  it("runs guarded calls through SDK permission callbacks instead of bypass mode", () => {
    const canUseTool = vi.fn(async () => ({ behavior: "allow" as const }));

    const options = buildQueryOptions({
      cwd: "/tmp/project",
      effort: "xhigh",
      permissionMode: "default",
      canUseTool,
    });

    expect(options).toMatchObject({
      permissionMode: "default",
      allowDangerouslySkipPermissions: false,
      canUseTool: expect.any(Function),
    });
  });

  it("runs read scopes through the pre-tool hook before SDK auto-approval", async () => {
    const canUseTool = composeCanUseTools(
      createClaudeAgentReadScopeGuard({
        cwd: "/workspace",
        agentReadScope: ["/workspace", "/canonical/review.jsonl"],
      }),
      createClaudeAgentWriteScopeGuard({
        cwd: "/workspace",
        agentWriteScope: "deny-all",
      }),
    );
    const options = buildQueryOptions({
      cwd: "/workspace",
      effort: "xhigh",
      permissionMode: "default",
      canUseTool,
      agentReadScope: ["/workspace", "/canonical/review.jsonl"],
    });
    expect(options.sandbox?.autoAllowBashIfSandboxed).toBe(false);
    const hook = options.hooks!.PreToolUse![0].hooks[0];
    const input = {
      hook_event_name: "PreToolUse" as const,
      session_id: "session",
      transcript_path: "native",
      cwd: "/workspace",
      tool_name: "Read",
      tool_use_id: "read",
      tool_input: { file_path: "/canonical/private.json" },
    };

    await expect(
      hook(input, "read", { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("outside the declared read roots"),
      },
    });
    await expect(
      hook({ ...input, tool_input: { file_path: "/canonical/review.jsonl" } }, "read", {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});
    await expect(
      hook({
        ...input,
        tool_name: "Bash",
        tool_use_id: "bash",
        tool_input: { command: "cat /canonical/private.json" },
      }, "bash", { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("local filesystem writes are denied"),
      },
    });
  });

  it("normalizes allow decisions to the SDK runtime permission contract", async () => {
    const input = { command: "pnpm build" };
    const canUseTool = vi.fn(async () => ({ behavior: "allow" as const }));
    const options = buildQueryOptions({
      cwd: "/tmp/project",
      effort: "xhigh",
      permissionMode: "default",
      canUseTool,
    });

    await expect(
      options.canUseTool?.("Bash", input, {
        signal: new AbortController().signal,
        // SDK callback uses the SDK's `toolUseID` shape; the wrapper bridges
        // it to the neutral `toolUseId` before calling the user's guard.
        toolUseID: "tool-1",
      }),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: input,
    });
  });

  it("preserves explicit permission input updates", () => {
    expect(
      normalizePermissionResult(
        { behavior: "allow", updatedInput: { command: "echo changed" } },
        { command: "echo original" },
      ),
    ).toEqual({ behavior: "allow", updatedInput: { command: "echo changed" } });
  });

  it("buildQueryOptions forwards MCP server config", () => {
    const mcpServers = {
      local: { type: "stdio" as const, command: "node", args: ["server.js"] },
    };

    expect(buildQueryOptions({ cwd: "/tmp/project", effort: "xhigh", mcpServers })).toMatchObject({
      mcpServers,
    });
  });

  it("returns immediately after the terminal result frame even if the iterator yields more", async () => {
    let unreachableYielded = false;
    const iterable: AsyncIterable<RawSdkTestMessage> = {
      async *[Symbol.asyncIterator]() {
        yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
        yield { type: "result", result: "done", subtype: "success", num_turns: 1 };
        // Simulate an SDK iterator that does not close after the terminal
        // `result` frame (observed under heavy throttling). The executor must
        // break on `result` rather than wait for `done`, otherwise the agent
        // step blocks until the workflow's hang-rail timeout discards the
        // already-completed work.
        unreachableYielded = true;
        yield { type: "assistant", message: { content: [{ type: "text", text: "after-result"}] } };
      },
    };
    mockQuery.mockReturnValue(iterable);

    const writer = makeWriter();
    const result = await executeWithAgentSDK("test", { effort: "xhigh" }, writer);

    expect(result.text).toBe("done");
    expect(result.subtype).toBe("success");
    expect(writer.text).toBe("ok");
    expect(unreachableYielded).toBe(false);
  });

  it("throws when abort signal fires between messages", async () => {
    const abortController = new AbortController();
    const timeoutError = new Error("Step timed out after 1000ms");

    mockQuery.mockReturnValue(
      makeIterable([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "first" }] },
        },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "second" }] },
        },
        {
          type: "result",
          result: "done",
          subtype: "success",
        },
      ]),
    );

    const writer = makeWriter();
    const onMessage = vi.fn(async () => {
      if (onMessage.mock.calls.length === 1) {
        abortController.abort(timeoutError);
      }
    });

    await expect(
      executeWithAgentSDK("test", { abortController, onMessage, effort: "xhigh" }, writer),
    ).rejects.toThrow("Step timed out after 1000ms");

    expect(writer.text).toBe("first");
  });

  it("throws immediately when abort signal is already set", async () => {
    const abortController = new AbortController();
    const reason = new Error("Already aborted");
    abortController.abort(reason);

    mockQuery.mockReturnValue(
      makeIterable([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "should not appear" }] },
        },
        { type: "result", result: "done", subtype: "success" },
      ]),
    );

    const writer = makeWriter();
    await expect(
      executeWithAgentSDK("test", { abortController, effort: "xhigh" }, writer),
    ).rejects.toThrow("Already aborted");

    expect(writer.text).toBe("");
  });

  it("force-kills a spawned Claude process when abort does not exit cleanly", () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const child = Object.assign(new EventEmitter(), {
      stdin: {},
      stdout: {},
      stderr: null,
      killed: false,
      exitCode: null as number | null,
      kill: vi.fn(),
    });
    mockSpawn.mockReturnValue(child);

    const spawned = spawnClaudeCodeProcessWithAbortKill({
      command: "claude",
      args: ["--output-format", "stream-json"],
      cwd: "/tmp/project",
      env: {},
      signal: abortController.signal,
    });

    abortController.abort(new Error("stop"));
    vi.advanceTimersByTime(SDK_ABORT_FORCE_KILL_MS);

    expect(spawned.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });
});

it("protects all scope conversations, retired generations, and native transcripts through hooks and shell policy", async () => {
  const store = "/canonical/.kota/openai-tools-agent-harness/sessions";
  const current = `${store}/owners/current/provider-1`;
  const options = buildQueryOptions({
    cwd: "/workspace", scopeRoot: "/canonical", effort: "high",
    sessionStorageDir: current, env: { CLAUDE_CONFIG_DIR: "/native-claude" },
  });
  const hook = options.hooks!.PreToolUse![0].hooks[0];
  const input = { hook_event_name: "PreToolUse" as const, session_id: "session", transcript_path: "native", cwd: "/workspace", tool_name: "Read", tool_use_id: "read", tool_input: { file_path: "" } };
  const targets = [
    `${current}/claude/transcript.json`,
    `${store}/owners/sibling/provider-0/claude/transcript.json`,
    `${store}/owners/current/provider-0/claude/transcript.json`,
    `${store}/ots_other-conversation.json`,
    "/workspace/.kota/openai-tools-agent-harness/sessions/ots_workspace.json",
    "/native-claude/projects/native/transcript.jsonl",
  ];
  for (const path of targets) {
    const toolInput = { file_path: path };
    expect(await hook({ ...input, tool_input: toolInput }, "read", { signal: new AbortController().signal })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(await options.canUseTool!("Read", toolInput, { signal: new AbortController().signal, toolUseID: "read" })).toMatchObject({ behavior: "deny" });
    for (const denied of [options.sandbox!.filesystem!.denyRead!, options.sandbox!.filesystem!.denyWrite!]) {
      expect(denied.some((root) => path === root || path.startsWith(`${root}/`))).toBe(true);
    }
  }
  for (const tool_name of ["Grep", "Glob"]) {
    expect(await hook({ ...input, tool_name, tool_input: { path: "/canonical" } }, "search", { signal: new AbortController().signal })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
  }
  expect(await hook({ ...input, tool_input: { file_path: "/workspace/source.ts" } }, "read", { signal: new AbortController().signal })).toEqual({});
});
