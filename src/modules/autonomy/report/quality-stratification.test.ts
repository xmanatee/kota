import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  writeBuilderArtifacts,
} from "./quality-stratification.test-helpers.js";

let projectDir: string;
let runsDir: string;

describe("quality stratification", () => {
  beforeEach(() => {
    projectDir = join(tmpdir(), `quality-stratification-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("keeps pooled review trends separate from workflow composition shifts", () => {
    const tasks = [task("task-a", "ready", "autonomy"), task("task-b", "ready", "security")];
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
    const tasks = [task("task-a", "ready", "autonomy"), task("task-b", "ready", "security")];
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

  it("stratifies code-health and follow-up signals while keeping missing metadata explicit", () => {
    const tasks = [
      task("task-clean", "done", "autonomy"),
      task("task-warning", "done", "autonomy"),
      task("task-followed", "done", "security"),
    ];
    const cleanRun = run("clean-run", "builder", WINDOW_START + MS_PER_DAY, "harness-a");
    const warningRun = run("warning-run", "builder", WINDOW_START + 2 * MS_PER_DAY, undefined);
    writeBuilderArtifacts(runsDir, cleanRun.id, "task-clean", ["src/modules/autonomy/report/a.ts"], "ok");
    writeBuilderArtifacts(runsDir, warningRun.id, "task-warning", ["src/modules/autonomy/report/b.ts"], "warning");

    const report = buildReport(runsDir, {
      tasks,
      runs: [cleanRun, warningRun],
      reviewScrutiny: reviewReport([
        reviewRecord("missing-review", "critic", "builder", true, undefined),
      ]),
      postCompletionFollowUps: postReport("task-followed", "task-repair", ["security"]),
    });

    expect(report.aggregates.find((row) => row.signal === "code-health-drift")?.current).toMatchObject({
      denominatorCount: 2,
      numeratorCount: 1,
    });
    expect(report.aggregates.find((row) => row.signal === "post-completion-follow-up")?.current.numeratorCount).toBe(1);
    expect(report.missingDimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "review-scrutiny", dimension: "harness", count: 1 }),
        expect.objectContaining({ signal: "review-scrutiny", dimension: "taskPriority", count: 1 }),
      ]),
    );
    expect(slice(report, "code-health-drift", "harness", "harness-a")?.weakEvidence).toBe(true);
  });

  it("omits prompts, raw tool payloads, diffs, costs, and credentials from JSON", () => {
    const unsafeRun = run("unsafe-run", "builder", WINDOW_START + MS_PER_DAY, "harness-a");
    unsafeRun.totalCostUsd = 999;
    unsafeRun.steps[0]!.output = {
      prompt: "raw prompt should not appear",
      rawToolPayload: "raw tool payload",
      diff: "secret diff",
      credential: "sk-test-secret",
    };
    const report = buildReport(runsDir, {
      tasks: [task("task-safe", "done", "autonomy", "sk-test-secret in task body")],
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
