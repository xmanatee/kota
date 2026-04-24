import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentStepRecording } from "./agent-step-recording.js";
import { recordingPathForStep } from "./agent-step-recording.js";
import {
  createReplayAgentHarness,
  REPLAY_AGENT_HARNESS_NAME_ENV,
  resolveReplayRootFromEnv,
} from "./replay-harness.js";

const RECORDING: AgentStepRecording = {
  version: 1,
  workflowName: "decomposer",
  stepId: "decompose",
  sourceRunId: "2026-04-18T15-45-49-339Z-decomposer-zloyo6",
  response: {
    text: "decomposed fixture",
    subtype: "success",
    turns: 12,
    totalCostUsd: 0.5,
    inputTokens: 100,
    outputTokens: 200,
    sessionId: "s-1",
  },
  fileOperations: [
    { op: "delete", path: "data/tasks/doing/task-target.md" },
    {
      op: "write",
      path: "data/tasks/dropped/task-target.md",
      content: "dropped contents",
    },
    {
      op: "write",
      path: "{{runDir}}/commit-message.txt",
      content: "replay commit message",
    },
  ],
};

function buildPrompt(runDir: string): string {
  return [
    "Execute one KOTA workflow step in this repository.",
    "Workflow: decomposer",
    "Step: decompose",
    "Run ID: replay-test-run",
    `Run directory: ${runDir}`,
    "Trigger event: workflow.completed",
  ].join("\n");
}

describe("createReplayAgentHarness", () => {
  let fixtureDir: string;
  let cwd: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "kota-replay-fixture-"));
    mkdirSync(join(fixtureDir, "recordings"));
    writeFileSync(
      recordingPathForStep(fixtureDir, "decompose"),
      JSON.stringify(RECORDING),
    );

    cwd = mkdtempSync(join(tmpdir(), "kota-replay-cwd-"));
    mkdirSync(join(cwd, "data", "tasks", "doing"), { recursive: true });
    writeFileSync(
      join(cwd, "data", "tasks", "doing", "task-target.md"),
      "initial body",
    );
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("applies file operations and returns the recorded response envelope", async () => {
    const harness = createReplayAgentHarness(fixtureDir);
    const runDir = ".kota/runs/replay-test-run";
    mkdirSync(join(cwd, runDir), { recursive: true });

    const result = await harness.run({
      prompt: buildPrompt(runDir),
      cwd,
      effort: "xhigh",
    });

    expect(result.isError).toBe(false);
    expect(result.text).toBe("decomposed fixture");
    expect(result.turns).toBe(12);
    expect(result.totalCostUsd).toBe(0.5);
    expect(result.sessionId).toBe("s-1");

    expect(
      existsSync(join(cwd, "data", "tasks", "doing", "task-target.md")),
    ).toBe(false);
    expect(
      readFileSync(
        join(cwd, "data", "tasks", "dropped", "task-target.md"),
        "utf-8",
      ),
    ).toBe("dropped contents");
    expect(
      readFileSync(join(cwd, runDir, "commit-message.txt"), "utf-8"),
    ).toBe("replay commit message");
  });

  it("stages mutations when the fixture cwd is a git repo", async () => {
    spawnSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd });
    spawnSync("git", ["config", "user.email", "t@local"], { cwd });
    spawnSync("git", ["config", "user.name", "t"], { cwd });
    spawnSync("git", ["add", "-A"], { cwd });
    spawnSync("git", ["commit", "--allow-empty", "-m", "init", "--quiet"], {
      cwd,
    });

    const harness = createReplayAgentHarness(fixtureDir);
    await harness.run({
      prompt: buildPrompt(".kota/runs/replay-test-run"),
      cwd,
      effort: "xhigh",
    });

    const status = spawnSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
    });
    // After replay, every mutation should appear in the index (uppercase
    // leading column), not the worktree-only lowercase column.
    for (const line of status.stdout.split("\n").filter(Boolean)) {
      const index = line[0];
      expect(index.trim()).not.toBe("");
    }
  });

  it("throws when the prompt does not declare Workflow/Step/Run directory", async () => {
    const harness = createReplayAgentHarness(fixtureDir);
    await expect(
      harness.run({ prompt: "no header here", cwd, effort: "xhigh" }),
    ).rejects.toThrow(/could not parse Workflow\/Step\/Run directory/);
  });

  it("throws when no recording is keyed to the requested step", async () => {
    const harness = createReplayAgentHarness(fixtureDir);
    const prompt = buildPrompt(".kota/runs/replay-test-run").replace(
      "Step: decompose",
      "Step: unknown-step",
    );
    await expect(
      harness.run({ prompt, cwd, effort: "xhigh" }),
    ).rejects.toThrow(/has no recording for step "unknown-step"/);
  });

  it("throws when the recording's workflow name does not match the prompt", async () => {
    const harness = createReplayAgentHarness(fixtureDir);
    const prompt = buildPrompt(".kota/runs/replay-test-run").replace(
      "Workflow: decomposer",
      "Workflow: different-workflow",
    );
    await expect(
      harness.run({ prompt, cwd, effort: "xhigh" }),
    ).rejects.toThrow(/declares workflow "decomposer" but the current run is workflow "different-workflow"/);
  });
});

describe("resolveReplayRootFromEnv", () => {
  it("returns null when the env var is unset", () => {
    expect(resolveReplayRootFromEnv({})).toBeNull();
  });

  it("returns the trimmed value when set", () => {
    expect(
      resolveReplayRootFromEnv({
        [REPLAY_AGENT_HARNESS_NAME_ENV]: "  /tmp/fixtures  ",
      }),
    ).toBe("/tmp/fixtures");
  });
});
