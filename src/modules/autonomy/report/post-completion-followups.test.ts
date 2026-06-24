import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aggregateAutonomyReport } from "./aggregate.js";

const NOW = Date.parse("2026-04-29T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function writeTask(
  projectDir: string,
  state: string,
  id: string,
  attrs: {
    priority: string;
    area: string;
    title?: string;
    summary?: string;
    updatedAt?: string;
    body?: string;
  },
): void {
  const dir = join(projectDir, "data", "tasks", state);
  mkdirSync(dir, { recursive: true });
  const updatedAt = attrs.updatedAt ?? new Date(NOW).toISOString();
  const title = attrs.title ?? id;
  const summary = attrs.summary ?? "fixture task";
  const body = attrs.body ?? "## Problem\n\nFixture task.\n";
  const content =
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${state}\npriority: ${attrs.priority}\n` +
    `area: ${attrs.area}\nsummary: ${summary}\ncreated_at: ${updatedAt}\nupdated_at: ${updatedAt}\n---\n\n${body}`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
}

function writeRun(
  runsDir: string,
  id: string,
  metadata: {
    workflow: string;
    startedAt: string;
    status: string;
    steps?: unknown[];
  },
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      id,
      definitionPath: `src/modules/autonomy/workflows/${metadata.workflow}/workflow.ts`,
      trigger: { event: "schedule", payload: {} },
      runDir: `.kota/runs/${id}`,
      durationMs: 1000,
      totalCostUsd: null,
      steps: metadata.steps ?? [],
      ...metadata,
    }),
  );
}

function writeRunSummary(
  runsDir: string,
  id: string,
  taskId: string,
  commitSha: string,
): void {
  writeFileSync(
    join(runsDir, id, "run-summary.json"),
    JSON.stringify({
      runId: id,
      workflow: "builder",
      taskId,
      taskTitle: taskId,
      outcome: "success",
      commitSha,
      commitMessage: "complete fixture task",
      filesChanged: [],
      costUsd: null,
      durationMs: null,
      completedAt: new Date(NOW - MS_PER_DAY).toISOString(),
    }),
  );
}

describe("post-completion corrective follow-up report", () => {
  let projectDir: string;
  let runsDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `post-completion-followups-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("links corrective open tasks to recent done evidence and excludes planned or operator-capture work", () => {
    const parentRunId = "2026-04-28T09-00-00-000Z-builder-parent";
    const sourceRunId = "2026-04-28T10-00-00-000Z-builder-source";
    writeRun(runsDir, parentRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - MS_PER_DAY).toISOString(),
      status: "success",
    });
    writeRunSummary(
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
    writeRunSummary(
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
        "## Problem\n\nThis source-size diagnostic compares existing surfaces.\n\n" +
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
    writeTask(projectDir, "ready", "task-source-size-follow-up", {
      priority: "p3",
      area: "autonomy",
      title: "Split oversized source-size fallout",
      updatedAt: new Date(NOW).toISOString(),
      body:
        "## Problem\n\nCreated by progress-reviewer after a source-size advisory.\n" +
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
      "task-source-size-follow-up",
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
      "source-size": 1,
      "operator-report": 2,
    });
    expect(
      followUps.links.find(
        (link) => link.activeFollowUpTaskId === "task-source-size-follow-up",
      ),
    ).toMatchObject({
      completedTaskId: "task-source-parent",
      reasons: ["source-size", "operator-report"],
      matchedRefs: [
        "git:commit:fedcba987654",
        `run:${sourceRunId}`,
      ],
    });
    expect(JSON.stringify(followUps)).not.toMatch(/cost|throughput/i);
  });
});
