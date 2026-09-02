import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION } from "#core/agent-harness/index.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() =>
  vi.fn((_cmd: string, args?: string[]) => {
    const argStr = args ? args.join(" ") : "";
    if (argStr.includes("version")) {
      return { status: 0, stdout: "codex 1.0.0\n", stderr: "" };
    }
    if (argStr.includes("login") || argStr.includes("status")) {
      return { status: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
    }
    return { status: 0, stdout: "/usr/local/bin/codex\n", stderr: "" };
  }),
);
const execFileSyncMock = vi.hoisted(() => vi.fn(() => "Logged in using ChatGPT"));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    execFileSync: execFileSyncMock,
    spawn: spawnMock,
    spawnSync: spawnSyncMock,
  };
});

import "../claude-agent-harness/index.js";
import "./index.js";
import { executeAgentStep } from "#core/workflow/steps/step-executor-agent.js";
import { CODEX_AGENT_HARNESS_NAME } from "./index.js";

function mockCodexProcess(): { stdinText: () => string } {
  const stdinChunks: Buffer[] = [];
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();

    child.stdin.on("data", (chunk: Buffer) => stdinChunks.push(chunk));

    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "done" },
      })}\n`);
      child.stdout.write(`${JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 1, output_tokens: 1 },
      })}\n`);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child;
  });

  return { stdinText: () => Buffer.concat(stdinChunks).toString("utf8") };
}

function makeDefinition(): WorkflowDefinition {
  return {
    name: "builder",
    enabled: true,
    repository: "read",
    tags: [],
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    steps: [],
  };
}

function makeMetadata(): WorkflowRunMetadata {
  return {
    id: "run-codex-ok",
    workflow: "builder",
    runDir: ".kota/runs/run-codex-ok",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
    startedAt: new Date().toISOString(),
    status: "running",
    steps: [],
  };
}

function makeAgentStep(moduleRoot: string): WorkflowAgentStep {
  return {
    id: "build",
    type: "agent",
    promptPath: "prompt.md",
    moduleRoot,
    model: "gpt-5.6-sol",
    effort: "xhigh",
    autonomyMode: "autonomous",
    harness: CODEX_AGENT_HARNESS_NAME,
  };
}

describe("autonomy agent step on codex", () => {
  let scopeRoot: string;

  beforeEach(() => {
    spawnMock.mockReset();
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue("Logged in using ChatGPT");
    scopeRoot = join(
      tmpdir(),
      `kota-codex-harness-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    writeFileSync(join(scopeRoot, "prompt.md"), "Stay focused on the build.");
    writeFileSync(
      join(scopeRoot, "AGENTS.md"),
      "# Project AGENTS\n\nPortable project rules live here.",
    );
    mkdirSync(join(scopeRoot, ".kota/runs/run-codex-ok/steps"), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

	it("runs workflow agent steps through Codex CLI native tool control", async () => {
		const codexProcess = mockCodexProcess();
		const onUsage = vi.fn();

    const result = await executeAgentStep(
      makeDefinition(),
      makeAgentStep(scopeRoot),
      makeMetadata(),
      { event: "autonomy.queue.available", schemaRef: null, payload: {} },
      new AbortController(),
      () => {},
      () => {},
			{ scopeRoot, log: () => {}, onUsage },
    );

    expect(result).toMatchObject({
      harness: CODEX_AGENT_HARNESS_NAME,
      model: "gpt-5.6-sol",
			output: {
				content: "done",
				turns: 1,
			},
		});
		expect(onUsage).toHaveBeenCalledWith({
			tokens: { state: "complete", inputTokens: 1, outputTokens: 1 },
			cost: { state: "unavailable", reason: "provider-does-not-report" },
		});
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][1]).not.toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
    expect(codexProcess.stdinText()).toContain("## KOTA workflow rails");
    expect(codexProcess.stdinText()).toContain(
      WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION,
    );
  });
});
