import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeWriterIntegrationFixture } from "#core/workflow/testing/writer-integration-fixture.js";
import {
  buildReport,
  MS_PER_DAY,
  postReport,
  run,
  task,
  WINDOW_START,
} from "./quality-stratification.test-helpers.js";

let workspaceRoot: string;
let runsDir: string;

describe("quality stratification", () => {
  beforeEach(() => {
    workspaceRoot = join(tmpdir(), `quality-stratification-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    runsDir = join(workspaceRoot, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("stratifies follow-up signals while keeping missing metadata explicit", () => {
    const tasks = [
      task("task-followed", "done"),
    ];
    writeWriterIntegrationFixture(runsDir, {
      runId: "run-followed",
      workflow: "builder",
      completedAt: new Date(WINDOW_START + MS_PER_DAY + 1000).toISOString(),
    });

    const report = buildReport(runsDir, {
      tasks,
      runs: [
        run(
          "run-followed",
          "builder",
          WINDOW_START + MS_PER_DAY,
          "harness-a",
          "task-followed",
        ),
      ],
      postCompletionFollowUps: postReport("task-followed", "task-repair", ["security"]),
    });

    expect(report.aggregates.find((row) => row.signal === "post-completion-follow-up")?.current.numeratorCount).toBe(1);
    expect(report.missingDimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "post-completion-follow-up", dimension: "changedArea", count: 1 }),
      ]),
    );
  });

  it("omits prompts, raw tool payloads, diffs, costs, and credentials from JSON", () => {
    const unsafeRun = run("unsafe-run", "builder", WINDOW_START + MS_PER_DAY, "harness-a");
    unsafeRun.usage = {
      tokens: { state: "complete", inputTokens: 999, outputTokens: 999 },
      cost: { state: "complete", usd: 999 },
    };
    unsafeRun.steps[0]!.output = {
      prompt: "raw prompt should not appear",
      rawToolPayload: "raw tool payload",
      diff: "secret diff",
      credential: "sk-test-secret",
    };
    const report = buildReport(runsDir, {
      tasks: [task("task-safe", "done", "sk-test-secret in task body")],
      runs: [unsafeRun],
    });

    const json = JSON.stringify(report);
    expect(json).not.toContain("raw prompt");
    expect(json).not.toContain("raw tool payload");
    expect(json).not.toContain("secret diff");
    expect(json).not.toContain("sk-test-secret");
    expect(json).not.toContain("999");
  });
});
