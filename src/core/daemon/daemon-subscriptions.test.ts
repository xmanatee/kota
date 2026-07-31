import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusEvents } from "#core/events/event-bus.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import {
  ApprovalQueue,
  resetApprovalQueue,
  setApprovalQueueInstance,
} from "./approval-queue.js";
import { subscribeDaemon } from "./daemon-subscriptions.js";
import {
  OwnerQuestionQueue,
  resetOwnerQuestionQueue,
  setOwnerQuestionQueueInstance,
} from "./owner-question-queue.js";
import { resetScheduler } from "./scheduler.js";

function makeProjectDir(name: string): string {
  const path = join(
    tmpdir(),
    `kota-daemon-subscriptions-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(path, { recursive: true });
  return path;
}

function makeWorkflowCompletedPayload(
  scopeName: string,
): Omit<BusEvents["workflow.completed"], "projectId" | "scopeId"> {
  return {
    workflow: `builder-${scopeName}`,
    runId: `run-${scopeName}`,
    status: "failed",
    triggerEvent: "runtime.idle",
    durationMs: 1000,
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    runDir: `.kota/runs/run-${scopeName}`,
    tags: [],
  };
}

describe("subscribeDaemon", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    resetApprovalQueue();
    resetOwnerQuestionQueue();
    resetScheduler();
    vi.useRealTimers();
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("subscribes workflow failure alerts for every configured scope", () => {
    const bus = new EventBus();
    const pbusA = new ProjectScopedEventBus(bus, "scope-a");
    const pbusB = new ProjectScopedEventBus(bus, "scope-b");
    const projectDirA = makeProjectDir("a");
    const projectDirB = makeProjectDir("b");
    projectDirs.push(projectDirA, projectDirB);
    const alerts: Array<BusEvents["workflow.failure.alert"] & { scopeId: string }> = [];
    bus.on("workflow.failure.alert", (payload) =>
      alerts.push(payload as BusEvents["workflow.failure.alert"] & { scopeId: string }),
    );

    const unsubscribe = subscribeDaemon({
      bus,
      failureAlertScopes: [
        { pbus: pbusA, projectDir: projectDirA },
        { pbus: pbusB, projectDir: projectDirB },
      ],
      pollIntervalMs: 60_000,
      onDueItems: () => {},
      onWorkflowCompleted: () => {},
      onRestartRequested: () => {},
      onLog: () => {},
    });

    pbusA.emit("workflow.completed", makeWorkflowCompletedPayload("a"));
    pbusB.emit("workflow.completed", makeWorkflowCompletedPayload("b"));
    unsubscribe();

    expect(alerts.map((alert) => alert.scopeId).sort()).toEqual([
      "scope-a",
      "scope-b",
    ]);
    expect(alerts.map((alert) => alert.projectId).sort()).toEqual([
      "scope-a",
      "scope-b",
    ]);
    expect(alerts.map((alert) => alert.workflow).sort()).toEqual([
      "builder-a",
      "builder-b",
    ]);
  });

  it("contains unverifiable restarted approvals without blocking valid expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));
    const approvalDir = mkdtempSync(join(tmpdir(), "approval-subscription-test-"));
    const questionDir = mkdtempSync(join(tmpdir(), "question-subscription-test-"));
    projectDirs.push(approvalDir, questionDir);

    const originalQueue = new ApprovalQueue(approvalDir);
    const priorDaemon = originalQueue.enqueue(
      "shell",
      { command: "deploy" },
      "dangerous",
      "operator approval required",
      undefined,
      50,
      "approve",
    );
    const restartedQueue = new ApprovalQueue(approvalDir);
    const liveDaemon = restartedQueue.enqueue(
      "shell",
      { command: "inspect" },
      "moderate",
      "live approval",
      undefined,
      1,
    );
    setApprovalQueueInstance(restartedQueue);
    setOwnerQuestionQueueInstance(new OwnerQuestionQueue(questionDir));
    const logs: string[] = [];
    const unsubscribe = subscribeDaemon({
      bus: new EventBus(),
      failureAlertScopes: [],
      pollIntervalMs: 10,
      onDueItems: () => {},
      onWorkflowCompleted: () => {},
      onRestartRequested: () => {},
      onLog: (message) => logs.push(message),
    });

    vi.advanceTimersByTime(10);
    expect(logs).toEqual([]);
    expect(restartedQueue.get(liveDaemon.id)?.status).toBe("expired");
    expect(restartedQueue.get(priorDaemon.id)?.status).toBe("pending");

    vi.advanceTimersByTime(39);
    expect(logs).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(logs).toEqual([
      expect.stringMatching(
        new RegExp(`failed closed.*${priorDaemon.id}`, "i"),
      ),
    ]);
    expect(restartedQueue.get(priorDaemon.id)?.status).toBe("pending");
    expect(restartedQueue.list("approved")).toHaveLength(0);
    vi.advanceTimersByTime(10);
    expect(logs).toHaveLength(1);
    unsubscribe();
  });
});
