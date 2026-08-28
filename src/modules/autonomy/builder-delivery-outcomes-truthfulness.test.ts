import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveWorkflowRunDelivery } from "#core/workflow/run-delivery.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { aggregateAutonomyReport } from "#modules/autonomy/report/aggregate.js";
import { readAutonomyRunDeliveryEvidence } from "#modules/autonomy/run-delivery-evidence.js";
import { collectProgressReviewEvidence } from "#modules/autonomy/workflows/progress-reviewer/progress-review/collect.js";
import { computeHistoryStats } from "#modules/workflow-ops/runs/workflow-history.js";

const NOW = Date.parse("2026-08-28T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("builder delivery outcomes truthfulness", () => {
  let workspaceRoot: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceRoot = join(tmpdir(), `kota-delivery-truth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    runsDir = join(workspaceRoot, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    mkdirSync(join(workspaceRoot, "data", "tasks"), { recursive: true });
    mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function writeTaskFile(
    state: "open" | "blocked" | "done" | "dropped",
    id: string,
    title: string,
    body = "## Problem\n\nWork.\n",
    blocker?: string,
  ) {
    const dir = state === "done" || state === "dropped"
      ? join(workspaceRoot, "data", "tasks", "archive")
      : join(workspaceRoot, "data", "tasks");
    const blockerSection = blocker ? `\n\n## Blocked on\n\n${blocker}` : "";
    const content = `---\nid: ${id}\ntitle: "${title}"\nstatus: ${state}\npriority: p1\n---\n\n# ${title}\n\n${body}${blockerSection}\n`;
    writeFileSync(join(dir, `${id}.md`), content, "utf-8");
  }

  function writeRunRecord(id: string, metadata: Partial<WorkflowRunMetadata>, changedPaths: string[] = []) {
    const dir = join(runsDir, id);
    mkdirSync(dir, { recursive: true });
    const fullMeta: WorkflowRunMetadata = {
      id,
      workflow: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runDir: `.kota/runs/${id}`,
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: {
          taskId: metadata.trigger?.payload?.taskId ?? "task-sample",
          title: metadata.trigger?.payload?.title ?? "Sample task",
        },
      },
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      completedAt: new Date(NOW - 1 * MS_PER_DAY + 60000).toISOString(),
      status: "success",
      durationMs: 60000,
      steps: [],
      ...metadata,
    };
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(fullMeta, null, 2), "utf-8");
    writeFileSync(join(dir, "trigger.json"), JSON.stringify(fullMeta.trigger, null, 2), "utf-8");
    if (changedPaths.length > 0) {
      writeFileSync(
        join(dir, "writer-integration.json"),
        JSON.stringify({
          version: 1,
          runId: id,
          workflow: fullMeta.workflow,
          scopeId: "scope-test",
          targetBranch: "main",
          baseHead: "base-sha",
          integratedFromHead: "integ-sha",
          publishedHead: "pub-sha-123",
          commitSubject: `Implement ${fullMeta.trigger?.payload?.taskId}`,
          commitMessage: `Implement ${fullMeta.trigger?.payload?.taskId}\n\nDetails.`,
          changedPaths,
          completedAt: fullMeta.completedAt,
        }, null, 2),
        "utf-8",
      );
    }
    return fullMeta;
  }

  it("distinguishes all 5 delivery dispositions across run metadata, history, progress review, and report aggregation", () => {
    // 1. Completed delivery (task moved to done)
    const taskDoneId = "task-completed-1";
    writeTaskFile("done", taskDoneId, "Completed Task");
    const completedRun = writeRunRecord("2026-08-20T10-00-00-000Z-builder-done1", {
      status: "success",
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: { taskId: taskDoneId, title: "Completed Task" } },
    }, ["src/app.ts", `data/tasks/archive/${taskDoneId}.md`]);

    // 2. Integrated-blocked delivery (task moved to blocked, preserving partial work and blocker)
    const taskBlockedId = "task-blocked-1";
    writeTaskFile("blocked", taskBlockedId, "Blocked Task", "Partial work done.", "operator-capture: capture remote log trace");
    const blockedRun = writeRunRecord("2026-08-20T11-00-00-000Z-builder-block1", {
      status: "success",
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: { taskId: taskBlockedId, title: "Blocked Task" } },
    }, ["src/partial.ts", `data/tasks/${taskBlockedId}.md`]);

    // 3. Needs-attention delivery
    const taskAttentionId = "task-attention-1";
    writeTaskFile("open", taskAttentionId, "Attention Task");
    const attentionRun = writeRunRecord("2026-08-20T12-00-00-000Z-builder-attn1", {
      status: "completed-with-warnings",
      delivery: { kind: "needs_attention", taskId: taskAttentionId, taskTitle: "Attention Task", reason: "stalled integration validation" },
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: { taskId: taskAttentionId, title: "Attention Task" } },
    });

    // 4. Cancelled delivery
    const taskCancelledId = "task-cancelled-1";
    writeTaskFile("open", taskCancelledId, "Cancelled Task");
    const cancelledRun = writeRunRecord("2026-08-20T13-00-00-000Z-builder-canc1", {
      status: "interrupted",
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: { taskId: taskCancelledId, title: "Cancelled Task" } },
    });

    // 5. Failed delivery
    const taskFailedId = "task-failed-1";
    writeTaskFile("open", taskFailedId, "Failed Task");
    const failedRun = writeRunRecord("2026-08-20T14-00-00-000Z-builder-fail1", {
      status: "failed",
      steps: [{ id: "agent", type: "agent", status: "failed", durationMs: 5000, error: "Model timeout error" }],
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: { taskId: taskFailedId, title: "Failed Task" } },
    });

    // Verify deriveWorkflowRunDelivery dispositions
    const d1 = deriveWorkflowRunDelivery(completedRun, { runsDir, workspaceRoot });
    expect(d1.kind).toBe("completed");
    expect(d1.taskId).toBe(taskDoneId);

    const d2 = deriveWorkflowRunDelivery(blockedRun, { runsDir, workspaceRoot });
    expect(d2.kind).toBe("blocked");
    expect(d2.taskId).toBe(taskBlockedId);
    expect(d2.blocker).toContain("operator-capture");

    const d3 = deriveWorkflowRunDelivery(attentionRun, { runsDir, workspaceRoot });
    expect(d3.kind).toBe("needs_attention");

    const d4 = deriveWorkflowRunDelivery(cancelledRun, { runsDir, workspaceRoot });
    expect(d4.kind).toBe("cancelled");

    const d5 = deriveWorkflowRunDelivery(failedRun, { runsDir, workspaceRoot });
    expect(d5.kind).toBe("failed");
    expect(d5.reason).toContain("Model timeout error");

    // Verify readAutonomyRunDeliveryEvidence
    const e1 = readAutonomyRunDeliveryEvidence(runsDir, completedRun);
    expect(e1?.disposition).toBe("completed");

    const e2 = readAutonomyRunDeliveryEvidence(runsDir, blockedRun);
    expect(e2?.disposition).toBe("blocked");
    expect(e2?.blockerReason).toContain("operator-capture");

    // Verify HistoryStats
    const historyStats = computeHistoryStats([
      { ...completedRun, delivery: d1 },
      { ...blockedRun, delivery: d2 },
      { ...attentionRun, delivery: d3 },
      { ...cancelledRun, delivery: d4 },
      { ...failedRun, delivery: d5 },
    ]);
    expect(historyStats.total).toBe(5);
    expect(historyStats.successes).toBe(3); // completedRun (success) + blockedRun (success) + attentionRun (completed-with-warnings)
    expect(historyStats.deliveries).toBe(1); // ONLY completedRun
    expect(historyStats.blocked).toBe(1); // blockedRun
    expect(historyStats.failures).toBe(1); // failedRun
    expect(historyStats.interrupted).toBe(1); // cancelledRun
    expect(historyStats.deliveryRate).toBe(20); // 1 out of 5 = 20%

    // Verify Report Aggregation / Throughput metrics
    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });
    // totalCommittedRuns in builder breakdown counts ONLY completed closures
    expect(report.builder.totalCommittedRuns).toBe(1);
    expect(report.builder.closures.map((c) => c.taskId)).toEqual([taskDoneId]);
    // doneInWindow queue balance only includes completed tasks
    expect(report.doneInWindow.total).toBe(1);
    expect(report.doneInWindow.byState.done).toBe(1);

    // Verify Progress Review evidence collection
    const progressEvidence = collectProgressReviewEvidence({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      trigger: { event: "manual", schemaRef: null, payload: { windowMs: 7 * MS_PER_DAY } },
      now: new Date(NOW),
    });
    const runEvMap = new Map(progressEvidence.runs.map((r) => [r.id.split(":run:")[1], r]));
    expect(runEvMap.get(completedRun.id)?.delivery?.kind).toBe("completed");
    expect(runEvMap.get(blockedRun.id)?.delivery?.kind).toBe("blocked");
    expect(runEvMap.get(attentionRun.id)?.delivery?.kind).toBe("needs_attention");
    expect(runEvMap.get(cancelledRun.id)?.delivery?.kind).toBe("cancelled");
    expect(runEvMap.get(failedRun.id)?.delivery?.kind).toBe("failed");
  });

  it("replays the cited historical builder run (2026-08-11T12-06-15-974Z-builder-2ztd9j, commit 2d15ad78a) without incrementing completed throughput", () => {
    const historicalTaskId = "task-recover-agy-builder-completion-reliability-from-th";
    writeTaskFile(
      "blocked",
      historicalTaskId,
      "Recover AGY builder completion reliability from the zero-success rollout",
      "Structural fixes implemented, but live proof blocked on operator capture.",
      "operator-capture: authenticated trusted-host AGY evidence",
    );

    const historicalRun = writeRunRecord("2026-08-11T12-06-15-974Z-builder-2ztd9j", {
      workflow: "builder",
      status: "success",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: {
          taskId: historicalTaskId,
          title: "Recover AGY builder completion reliability from the zero-success rollout",
        },
      },
    }, [
      "src/core/agent-harness/machine-authority-sandbox.ts",
      "src/core/workflow/repair-loop.ts",
      `data/tasks/${historicalTaskId}.md`,
    ]);

    const delivery = deriveWorkflowRunDelivery(historicalRun, { runsDir, workspaceRoot });
    expect(delivery.kind).toBe("blocked");
    expect(delivery.taskId).toBe(historicalTaskId);
    expect(delivery.blocker).toContain("operator-capture");

    const evidence = readAutonomyRunDeliveryEvidence(runsDir, historicalRun);
    expect(evidence?.disposition).toBe("blocked");
    expect(evidence?.publishedHead).toBe("pub-sha-123");

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 30,
    });
    // Completed closures does not include the blocked run
    expect(report.builder.totalCommittedRuns).toBe(0);
    expect(report.builder.closures).toHaveLength(0);
    expect(report.doneInWindow.total).toBe(0);

    const history = computeHistoryStats([{ ...historicalRun, delivery }]);
    expect(history.total).toBe(1);
    expect(history.successes).toBe(1); // execution succeeded
    expect(history.deliveries).toBe(0); // task delivery not completed
    expect(history.blocked).toBe(1); // task delivery blocked
    expect(history.deliveryRate).toBe(0);
  });
});

