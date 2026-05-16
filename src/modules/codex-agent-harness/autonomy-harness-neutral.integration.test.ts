import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";

const spawnMock = vi.hoisted(() => vi.fn());
const execFileSyncMock = vi.hoisted(() => vi.fn(() => ""));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, execFileSync: execFileSyncMock, spawn: spawnMock };
});

import "../claude-agent-harness/index.js";
import "./index.js";
import { executeAgentStep } from "#core/workflow/steps/step-executor-agent.js";
import { CODEX_AGENT_HARNESS_NAME } from "./index.js";

function mockCodexProcess(): { stdinText: () => string } {
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

  const stdinChunks: Buffer[] = [];
  child.stdin.on("data", (chunk: Buffer) => stdinChunks.push(chunk));

  spawnMock.mockReturnValue(child);
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

  return { stdinText: () => Buffer.concat(stdinChunks).toString("utf8") };
}

function makeDefinition(): WorkflowDefinition {
  return {
    name: "builder",
    enabled: true,
    recoveryCapable: false,
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
    trigger: { event: "autonomy.queue.available", payload: {} },
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
    model: "gpt-5.5",
    effort: "xhigh",
    autonomyMode: "autonomous",
    harness: CODEX_AGENT_HARNESS_NAME,
  };
}

describe("autonomy agent step on codex", () => {
  let projectDir: string;

  beforeEach(() => {
    spawnMock.mockReset();
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue("");
    projectDir = join(
      tmpdir(),
      `kota-codex-harness-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "Stay focused on the build.");
    writeFileSync(
      join(projectDir, "AGENTS.md"),
      "# Project AGENTS\n\nPortable project rules live here.",
    );
    mkdirSync(join(projectDir, ".kota/runs/run-codex-ok/steps"), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("runs workflow agent steps through Codex CLI native tool control", async () => {
    const codexProcess = mockCodexProcess();

    const result = await executeAgentStep(
      makeDefinition(),
      makeAgentStep(projectDir),
      makeMetadata(),
      { event: "autonomy.queue.available", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(result).toMatchObject({
      harness: CODEX_AGENT_HARNESS_NAME,
      model: "gpt-5.5",
      output: {
        content: "done",
        inputTokens: 1,
        outputTokens: 1,
        turns: 1,
      },
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        "--sandbox",
        "workspace-write",
        "-c",
        'approval_policy="never"',
      ]),
    );
    expect(codexProcess.stdinText()).toContain("## KOTA workflow rails");
    expect(codexProcess.stdinText()).toContain("Do not run `git commit`");
  });
});
