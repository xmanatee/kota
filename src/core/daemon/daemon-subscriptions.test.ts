import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
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

describe("subscribeDaemon", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    resetApprovalQueue();
    resetOwnerQuestionQueue();
    resetScheduler();
    vi.useRealTimers();
    for (const scopeRoot of scopeRoots.splice(0)) {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("contains unverifiable restarted approvals without blocking valid expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));
    const approvalDir = mkdtempSync(join(tmpdir(), "approval-subscription-test-"));
    const questionDir = mkdtempSync(join(tmpdir(), "question-subscription-test-"));
    scopeRoots.push(approvalDir, questionDir);

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
      approvalQueues: () => [restartedQueue],
      pollIntervalMs: 10,
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
