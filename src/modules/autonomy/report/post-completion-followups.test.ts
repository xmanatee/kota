import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aggregateAutonomyReport } from "./aggregate.js";
import {
  createPostCompletionFollowUpsFixture,
  MS_PER_DAY,
  NOW,
  writeRun,
  writeTask,
  writeWriterIntegration,
} from "./post-completion-followups.test-helpers.js";

describe("post-completion corrective follow-up report", () => {
  let projectDir: string;
  let runsDir: string;
  let cleanupFixture: () => void;

  beforeEach(() => {
    const fixture = createPostCompletionFollowUpsFixture();
    projectDir = fixture.projectDir;
    runsDir = fixture.runsDir;
    cleanupFixture = fixture.cleanup;
  });

  afterEach(() => {
    cleanupFixture();
  });

  it("links corrective open tasks to recent done evidence and excludes planned or operator-capture work", () => {
    const parentRunId = "2026-04-28T09-00-00-000Z-builder-parent";
    const sourceRunId = "2026-04-28T10-00-00-000Z-builder-source";
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
    writeRun(runsDir, sourceRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - MS_PER_DAY).toISOString(),
      status: "success",
    });
    writeWriterIntegration(
      runsDir,
      sourceRunId,
      "task-source-parent",
      "fedcba987654",
    );

    writeTask(projectDir, "done", "task-completed-parent", {
      priority: "p2",
      area: "autonomy",
      updatedAt: new Date(NOW - MS_PER_DAY).toISOString(),
      body: "## Acceptance Evidence\n\n- Builder run landed the parent change.\n",
    });
    writeTask(projectDir, "done", "task-source-parent", {
      priority: "p2",
      area: "autonomy",
      updatedAt: new Date(NOW - MS_PER_DAY).toISOString(),
      body: "## Acceptance Evidence\n\n- Builder run landed the source change.\n",
    });
    writeTask(projectDir, "ready", "task-progress-regression-follow-up", {
      priority: "p2",
      area: "autonomy",
      title: "Fix regression from progress review",
      updatedAt: new Date(NOW).toISOString(),
      body:
        "## Problem\n\nCreated by progress-reviewer after review verdict: needs-steering.\n" +
        `Evidence ids:\n\n- run:${parentRunId}\n- git:commit:abc123def456\n\n` +
        "The runtime regression needs a corrective follow-up.\n",
    });
    writeTask(projectDir, "ready", "task-planned-sibling", {
      priority: "p2",
      area: "autonomy",
      title: "Planned sibling for the parent initiative",
      updatedAt: new Date(NOW).toISOString(),
      body:
        "## Problem\n\nThis planned sibling references " +
        `task-completed-parent and ${parentRunId}, but it is normal decomposition.\n`,
    });
    writeTask(projectDir, "ready", "task-local-overlap-diagnostic", {
      priority: "p2",
      area: "autonomy",
      title: "Record lifecycle diagnostic without linking overlap checks",
      updatedAt: new Date(NOW).toISOString(),
      body:
        "## Problem\n\nThis lifecycle diagnostic compares existing surfaces.\n\n" +
        "## Source / Intent\n\nLocal overlap check:\n\n" +
        "- `task-completed-parent` already covers review-scrutiny at completion time.\n\n" +
        "The nonduplicative gap is a new report metric.\n",
    });
    writeTask(projectDir, "blocked", "task-operator-capture-follow-up", {
      priority: "p2",
      area: "client",
      title: "Capture missing evidence for completed parent",
      updatedAt: new Date(NOW).toISOString(),
      body:
        "## Problem\n\nMissing evidence cites " +
        `${parentRunId} and git:commit:abc123def456.\n\n` +
        "## Unblock Precondition\n\nkind: operator-capture\npath: .kota/runs/capture.png\ndescription: Capture the operator-visible proof.\n",
    });
    writeTask(projectDir, "ready", "task-workflow-failure-follow-up", {
      priority: "p3",
      area: "autonomy",
      title: "Repair recurring workflow failure",
      updatedAt: new Date(NOW).toISOString(),
      body:
        "## Problem\n\nCreated by progress-reviewer after a workflow-failure report.\n" +
        `Evidence ids:\n\n- run:${sourceRunId}\n- git:commit:fedcba987654\n`,
    });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });
    const followUps = report.postCompletionFollowUps;

    expect(followUps.totalCorrectiveFollowUps).toBe(2);
    expect(followUps.linkedCompletedTaskCount).toBe(2);
    expect(followUps.completedTaskIds).toEqual([
      "task-completed-parent",
      "task-source-parent",
    ]);
    expect(followUps.activeFollowUpTaskIds).toEqual([
      "task-progress-regression-follow-up",
      "task-workflow-failure-follow-up",
    ]);
    expect(followUps.activeFollowUpTaskIds).not.toContain("task-planned-sibling");
    expect(followUps.activeFollowUpTaskIds).not.toContain(
      "task-local-overlap-diagnostic",
    );
    expect(followUps.activeFollowUpTaskIds).not.toContain(
      "task-operator-capture-follow-up",
    );

    const byReason = Object.fromEntries(
      followUps.byReason.map((row) => [row.reason, row.count]),
    );
    expect(byReason).toMatchObject({
      regression: 1,
      "workflow-failure": 1,
      "operator-report": 2,
    });
    expect(
      followUps.links.find(
        (link) => link.activeFollowUpTaskId === "task-workflow-failure-follow-up",
      ),
    ).toMatchObject({
      completedTaskId: "task-source-parent",
      reasons: ["workflow-failure", "operator-report"],
      matchedRefs: [
        "git:commit:fedcba987654",
        `run:${sourceRunId}`,
      ],
    });
    expect(JSON.stringify(followUps)).not.toMatch(/cost|throughput/i);
  });

  it("classifies linked CI/build follow-ups without reclassifying planned test expansion", () => {
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

    writeTask(projectDir, "done", "task-completed-parent", {
      priority: "p2",
      area: "autonomy",
      updatedAt: new Date(NOW - MS_PER_DAY).toISOString(),
      body: "## Acceptance Evidence\n\n- Builder run landed the parent change.\n",
    });
    writeTask(projectDir, "ready", "task-ci-failure-follow-up", {
      priority: "p2",
      area: "autonomy",
      title: "Repair failed CI after completed parent",
      updatedAt: new Date(NOW).toISOString(),
      body:
        "## Problem\n\nCI failed after the completed builder work landed.\n\n" +
        `Evidence ids:\n\n- run:${parentRunId}\n- git:commit:abc123def456\n\n` +
        "The follow-up should be counted as integration-boundary breakage.\n",
    });
    writeTask(projectDir, "ready", "task-generic-regression-follow-up", {
      priority: "p2",
      area: "autonomy",
      title: "Repair generic runtime regression",
      updatedAt: new Date(NOW).toISOString(),
      body:
        "## Problem\n\nA runtime regression references the completed parent.\n\n" +
        `Evidence ids:\n\n- run:${parentRunId}\n`,
    });
    writeTask(projectDir, "ready", "task-planned-test-expansion", {
      priority: "p2",
      area: "autonomy",
      title: "Planned test expansion sibling",
      updatedAt: new Date(NOW).toISOString(),
      body:
        "## Problem\n\nThis planned sibling adds ordinary test coverage for " +
        `task-completed-parent after ${parentRunId}; it is not corrective fallout.\n`,
    });
    writeTask(projectDir, "blocked", "task-blocked-ci-capture", {
      priority: "p2",
      area: "client",
      title: "Capture CI failure evidence for completed parent",
      updatedAt: new Date(NOW).toISOString(),
      body:
        "## Problem\n\nCI failed after " +
        `${parentRunId} and git:commit:abc123def456.\n\n` +
        "## Unblock Precondition\n\nkind: operator-capture\npath: .kota/runs/capture.png\ndescription: Capture the operator-visible proof.\n",
    });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });
    const followUps = report.postCompletionFollowUps;

    expect(followUps.activeFollowUpTaskIds).toEqual([
      "task-ci-failure-follow-up",
      "task-generic-regression-follow-up",
    ]);
    expect(followUps.activeFollowUpTaskIds).not.toContain(
      "task-planned-test-expansion",
    );
    expect(followUps.activeFollowUpTaskIds).not.toContain(
      "task-blocked-ci-capture",
    );

    const ciLink = followUps.links.find(
      (link) => link.activeFollowUpTaskId === "task-ci-failure-follow-up",
    );
    expect(ciLink).toMatchObject({
      completedTaskId: "task-completed-parent",
      reasons: ["ci-build-failure"],
      matchedRefs: [
        "git:commit:abc123def456",
        `run:${parentRunId}`,
      ],
    });

    const regressionLink = followUps.links.find(
      (link) => link.activeFollowUpTaskId === "task-generic-regression-follow-up",
    );
    expect(regressionLink).toMatchObject({
      completedTaskId: "task-completed-parent",
      reasons: ["regression"],
    });

    const byReason = Object.fromEntries(
      followUps.byReason.map((row) => [row.reason, row.count]),
    );
    expect(byReason).toMatchObject({
      "ci-build-failure": 1,
      regression: 1,
    });
    expect(JSON.stringify(followUps)).not.toMatch(/cost|throughput/i);
  });
});
