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

  it("throws when the prompt shape is not a recognized workflow-step or judge call", async () => {
    const harness = createReplayAgentHarness(fixtureDir);
    await expect(
      harness.run({ prompt: "no header here", cwd, effort: "xhigh" }),
    ).rejects.toThrow(/does not recognize this agent-prompt shape/);
  });

  it("throws when a step prompt has the header but is missing one of the marker lines", async () => {
    const harness = createReplayAgentHarness(fixtureDir);
    await expect(
      harness.run({
        prompt: [
          "Execute one KOTA workflow step in this repository.",
          "Workflow: decomposer",
          "Run directory: .kota/runs/replay-test-run",
        ].join("\n"),
        cwd,
        effort: "xhigh",
      }),
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

  it("throws when the recording's workflow name does not match the step prompt", async () => {
    const harness = createReplayAgentHarness(fixtureDir);
    const prompt = buildPrompt(".kota/runs/replay-test-run").replace(
      "Workflow: decomposer",
      "Workflow: different-workflow",
    );
    await expect(
      harness.run({ prompt, cwd, effort: "xhigh" }),
    ).rejects.toThrow(/declares workflow "decomposer" but the current run is workflow "different-workflow"/);
  });

  it("replays a critic-style judge prompt against the critic-review recording", async () => {
    const criticRecording: AgentStepRecording = {
      version: 1,
      workflowName: "builder",
      stepId: "critic-review",
      sourceRunId: "2026-04-18T15-45-49-339Z-decomposer-zloyo6",
      response: {
        text: JSON.stringify({
          verdict: "pass",
          critical_issues: [],
          warnings: [],
          summary: "Replay.",
        }),
        subtype: "success",
        turns: 3,
        totalCostUsd: 0.1,
        inputTokens: 50,
        outputTokens: 25,
      },
      fileOperations: [],
    };
    writeFileSync(
      recordingPathForStep(fixtureDir, "critic-review"),
      JSON.stringify(criticRecording),
    );
    const harness = createReplayAgentHarness(fixtureDir);
    const judgePrompt = [
      "## Task (what was asked)",
      "seed task body",
      "",
      "## Task state",
      "data/tasks/done/task-x.md (done)",
      "",
      "## Review context",
      "Project root: /tmp/project",
      "Run directory: .kota/runs/replay-test-run",
      "",
      "## Diff summary",
      "one file",
    ].join("\n");
    const result = await harness.run({
      prompt: judgePrompt,
      cwd,
      effort: "xhigh",
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text).verdict).toBe("pass");
  });

  it("replays an improver semantic-gate prompt against the semantic-gate-review recording", async () => {
    const gateRecording: AgentStepRecording = {
      version: 1,
      workflowName: "improver",
      stepId: "semantic-gate-review",
      sourceRunId: "2026-04-24T17-23-37-109Z-improver-tqqgmc",
      response: {
        text: JSON.stringify({
          verdict: "pass",
          critical_issues: [],
          warnings: [],
          summary: "Gate replay.",
        }),
        subtype: "success",
        turns: 1,
        totalCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
      fileOperations: [],
    };
    writeFileSync(
      recordingPathForStep(fixtureDir, "semantic-gate-review"),
      JSON.stringify(gateRecording),
    );
    const harness = createReplayAgentHarness(fixtureDir);
    const gatePrompt = [
      "## Commit message",
      "A real improver commit",
      "",
      "## Changed files",
      "src/foo.ts",
      "",
      "## Review context",
      "Project root: /tmp/project",
      "Run directory: .kota/runs/replay-test-run",
    ].join("\n");
    const result = await harness.run({
      prompt: gatePrompt,
      cwd,
      effort: "xhigh",
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text).verdict).toBe("pass");
  });

  it("skips the workflow-name match on judge prompts even when the recording declares a different workflow", async () => {
    // Declaring a workflow name on judge recordings is allowed for
    // traceability; the adapter does not enforce a match because the judge
    // prompt shape never names a workflow. Recording declares "builder" while
    // the fixture's other recording is "decomposer"; both coexist.
    const criticRecording: AgentStepRecording = {
      version: 1,
      workflowName: "builder",
      stepId: "critic-review",
      sourceRunId: "2026-04-18T15-45-49-339Z-decomposer-zloyo6",
      response: {
        text: '{"verdict":"pass","critical_issues":[],"warnings":[],"summary":""}',
        subtype: "success",
        turns: 1,
        totalCostUsd: 0,
        inputTokens: 1,
        outputTokens: 1,
      },
      fileOperations: [],
    };
    writeFileSync(
      recordingPathForStep(fixtureDir, "critic-review"),
      JSON.stringify(criticRecording),
    );
    const harness = createReplayAgentHarness(fixtureDir);
    const judgePrompt = [
      "## Task (what was asked)",
      "body",
      "",
      "## Review context",
      "Run directory: .kota/runs/replay-test-run",
    ].join("\n");
    await expect(
      harness.run({ prompt: judgePrompt, cwd, effort: "xhigh" }),
    ).resolves.toBeDefined();
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
