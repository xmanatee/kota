import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aggregateAutonomyReport } from "./aggregate.js";
import { POST_COMPLETION_FOLLOW_UP_LINK_LIMIT } from "./post-completion-followups.js";
import {
  createPostCompletionFollowUpsFixture,
  MS_PER_DAY,
  NOW,
  writeRun,
  writeTask,
  writeWriterIntegration,
} from "./post-completion-followups.test-helpers.js";

describe("post-completion follow-up quality stratification", () => {
  let workspaceRoot: string;
  let runsDir: string;
  let cleanupFixture: () => void;

  beforeEach(() => {
    const fixture = createPostCompletionFollowUpsFixture();
    workspaceRoot = fixture.workspaceRoot;
    runsDir = fixture.runsDir;
    cleanupFixture = fixture.cleanup;
  });

  afterEach(() => {
    cleanupFixture();
  });

  it("keeps quality stratification counts complete beyond bounded report links", () => {
    const linkCount = 13;
    for (let index = 0; index < linkCount; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const runId = `2026-04-28T09-${suffix}-00-000Z-builder-parent`;
      const completedTaskId = `task-completed-parent-${suffix}`;
      const followUpTaskId = `task-regression-follow-up-${suffix}`;
      const commitSha = `abc123def4${suffix}`;

      writeRun(runsDir, runId, {
        workflow: "builder",
        startedAt: new Date(NOW - MS_PER_DAY).toISOString(),
        status: "success",
      });
      writeWriterIntegration(runsDir, runId, completedTaskId, commitSha);
      writeTask(workspaceRoot, "done", completedTaskId, {
        priority: "p2",
        body: "## Acceptance Evidence\n\n- Builder run landed the parent change.\n",
      });
      writeTask(workspaceRoot, "open", followUpTaskId, {
        priority: "p2",
        title: `Fix regression follow-up ${suffix}`,
        body:
          "## Problem\n\nA runtime regression cites completed builder evidence.\n\n" +
          `Evidence ids:\n\n- run:${runId}\n- git:commit:${commitSha}\n`,
      });
    }

    const report = aggregateAutonomyReport({
      workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.postCompletionFollowUps.activeFollowUpTaskIds).toHaveLength(
      linkCount,
    );
    expect(report.postCompletionFollowUps.links).toHaveLength(
      POST_COMPLETION_FOLLOW_UP_LINK_LIMIT,
    );
    expect(report.postCompletionFollowUps.truncatedLinkCount).toBe(
      linkCount - POST_COMPLETION_FOLLOW_UP_LINK_LIMIT,
    );
    expect(
      report.qualityStratification.aggregates.find(
        (row) => row.signal === "post-completion-follow-up",
      )?.current,
    ).toMatchObject({
      denominatorCount: linkCount,
      numeratorCount: linkCount,
    });
    expect(
      report.qualityStratification.slices.find(
        (row) =>
          row.signal === "post-completion-follow-up" &&
          row.dimension === "reasonFamily" &&
          row.value === "regression",
      )?.current.numeratorCount,
    ).toBe(linkCount);
  });

  it("counts every reason-family slice for multiple follow-ups on one completed task", () => {
    const parentRunId = "2026-04-28T09-00-00-000Z-builder-parent";
    writeRun(runsDir, parentRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - MS_PER_DAY).toISOString(),
      status: "success",
    });
    writeWriterIntegration(
      runsDir,
      parentRunId,
      "task-completed-parent",
      "abc123def456",
    );
    writeTask(workspaceRoot, "done", "task-completed-parent", {
      priority: "p2",
      body: "## Acceptance Evidence\n\n- Builder run landed the parent change.\n",
    });
    writeTask(workspaceRoot, "open", "task-regression-follow-up", {
      priority: "p2",
      title: "Fix runtime regression after completed parent",
      body:
        "## Problem\n\nA runtime regression cites completed builder evidence.\n\n" +
        `Evidence ids:\n\n- run:${parentRunId}\n- git:commit:abc123def456\n`,
    });
    writeTask(workspaceRoot, "open", "task-security-follow-up", {
      priority: "p2",
      title: "Fix security approval boundary after completed parent",
      body:
        "## Problem\n\nA security approval boundary issue cites completed builder evidence.\n\n" +
        `Evidence ids:\n\n- run:${parentRunId}\n- git:commit:abc123def456\n`,
    });

    const report = aggregateAutonomyReport({
      workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.postCompletionFollowUps.totalCorrectiveFollowUps).toBe(2);
    expect(
      report.qualityStratification.aggregates.find(
        (row) => row.signal === "post-completion-follow-up",
      )?.current,
    ).toMatchObject({
      denominatorCount: 1,
      numeratorCount: 1,
    });
    const reasonSlices = new Map(
      report.qualityStratification.slices
        .filter(
          (row) =>
            row.signal === "post-completion-follow-up" &&
            row.dimension === "reasonFamily",
        )
        .map((row) => [row.value, row.current.numeratorCount]),
    );
    expect(reasonSlices.get("regression")).toBe(1);
    expect(reasonSlices.get("security")).toBe(1);
  });
});
