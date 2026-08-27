import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeWriterIntegrationFixture } from "#core/workflow/testing/writer-integration-fixture.js";
import {
  buildReport,
  MS_PER_DAY,
  PRIOR_START,
  postReport,
  reviewRecord,
  reviewRecords,
  reviewReport,
  reviewRuns,
  run,
  slice,
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

  it("keeps pooled review trends separate from workflow composition shifts", () => {
    const tasks = [task("task-a", "open"), task("task-b", "open")];
    const runs = [
      ...reviewRuns("prior-a", "builder-a", "harness-a", 10, PRIOR_START + MS_PER_DAY),
      ...reviewRuns("prior-b", "builder-b", "harness-b", 1, PRIOR_START + MS_PER_DAY),
      ...reviewRuns("current-a", "builder-a", "harness-a", 10, WINDOW_START + MS_PER_DAY),
      ...reviewRuns("current-b", "builder-b", "harness-b", 10, WINDOW_START + MS_PER_DAY),
    ];
    const priorRecords = [
      ...reviewRecords("prior-a", "builder-a", "task-a", 10, 1),
      ...reviewRecords("prior-b", "builder-b", "task-b", 1, 1),
    ];
    const currentRecords = [
      ...reviewRecords("current-a", "builder-a", "task-a", 10, 1),
      ...reviewRecords("current-b", "builder-b", "task-b", 10, 9),
    ];

    const report = buildReport(runsDir, {
      tasks,
      runs,
      reviewScrutiny: reviewReport(currentRecords),
      priorReviewScrutiny: reviewReport(priorRecords),
    });

    const aggregate = report.aggregates.find((row) => row.signal === "review-scrutiny");
    expect(aggregate?.rateDelta).toBeGreaterThan(0);
    expect(slice(report, "review-scrutiny", "workflow", "builder-a")?.rateDelta).toBe(0);
    expect(slice(report, "review-scrutiny", "workflow", "builder-b")?.rateDelta).toBeLessThan(0);
    expect(report.compositionShifts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal: "review-scrutiny",
          dimension: "workflow",
          value: "builder-b",
        }),
      ]),
    );
  });

  it("keeps isolated slice regressions visible when pooled review rate is flat", () => {
    const tasks = [task("task-a", "open"), task("task-b", "open")];
    const runs = [
      ...reviewRuns("prior-a", "builder-a", "harness-a", 3, PRIOR_START + MS_PER_DAY),
      ...reviewRuns("prior-b", "builder-b", "harness-b", 3, PRIOR_START + MS_PER_DAY),
      ...reviewRuns("current-a", "builder-a", "harness-a", 3, WINDOW_START + MS_PER_DAY),
      ...reviewRuns("current-b", "builder-b", "harness-b", 3, WINDOW_START + MS_PER_DAY),
    ];
    const report = buildReport(runsDir, {
      tasks,
      runs,
      reviewScrutiny: reviewReport([
        ...reviewRecords("current-a", "builder-a", "task-a", 3, 3),
        ...reviewRecords("current-b", "builder-b", "task-b", 3, 0),
      ]),
      priorReviewScrutiny: reviewReport([
        ...reviewRecords("prior-a", "builder-a", "task-a", 3, 0),
        ...reviewRecords("prior-b", "builder-b", "task-b", 3, 3),
      ]),
    });

    expect(report.aggregates.find((row) => row.signal === "review-scrutiny")?.rateDelta).toBe(0);
    expect(slice(report, "review-scrutiny", "workflow", "builder-a")?.rateDelta).toBe(1);
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
      reviewScrutiny: reviewReport([
        reviewRecord("missing-review", "critic", "builder", true, undefined),
      ]),
      postCompletionFollowUps: postReport("task-followed", "task-repair", ["security"]),
    });

    expect(report.aggregates.find((row) => row.signal === "post-completion-follow-up")?.current.numeratorCount).toBe(1);
    expect(report.missingDimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "review-scrutiny", dimension: "harness", count: 1 }),
        expect.objectContaining({ signal: "review-scrutiny", dimension: "taskPriority", count: 1 }),
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
      reviewScrutiny: reviewReport([
        reviewRecord("unsafe-run", "critic", "builder", true, "task-safe"),
      ]),
    });

    const json = JSON.stringify(report);
    expect(json).not.toContain("raw prompt");
    expect(json).not.toContain("raw tool payload");
    expect(json).not.toContain("secret diff");
    expect(json).not.toContain("sk-test-secret");
    expect(json).not.toContain("999");
  });
});
