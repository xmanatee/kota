import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { WorkflowApprovalStepInput } from "../step-input-control-flow.js";
import { executeApprovalStep } from "./step-executor-approval.js";

const { mockEmit } = vi.hoisted(() => ({ mockEmit: vi.fn() }));

let testQueue: ApprovalQueue;
let tmpDir: string;

function approvePending(id: string, note?: string): void {
  const selection = testQueue.getExecutionSnapshot(id);
  if (!selection.ok) throw new Error("expected execution snapshot");
  const result = testQueue.approveForExecution(selection.snapshot.descriptor, note);
  if (!result.ok) throw new Error("expected execution approval");
}

beforeEach(() => {
  vi.useFakeTimers();
  tmpDir = mkdtempSync(join(tmpdir(), "approval-step-test-"));
  testQueue = new ApprovalQueue(tmpDir);
  mockEmit.mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeContext() {
  return {
    workspaceRoot: "/project",
    workflow: { name: "test-wf", definitionPath: "src/wf.ts", runId: "run-1", runDir: ".kota/runs/run-1", runDirPath: "/project/.kota/runs/run-1" },
    trigger: { event: "runtime.idle" as const, payload: {} },
    approvalQueue: testQueue,
    previousOutput: null,
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    runTool: () => Promise.reject(new Error("not used")),
    emit: mockEmit,
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({ completedRuns: 0, workflows: {} }),
    triggerWorkflow: () => Promise.reject(new Error("not used")),
  };
}

function makeApprovalStep(overrides: Partial<WorkflowApprovalStepInput> = {}): WorkflowApprovalStepInput {
  return { id: "gate", type: "approval", ...overrides };
}

describe("executeApprovalStep – note propagation", () => {
  it("includes approvalNote in output when approved with a note", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep();
    const stepPromise = executeApprovalStep(step as never, makeContext() as never, ac.signal);

    const pending = testQueue.list("pending");
    expect(pending).toHaveLength(1);
    approvePending(pending[0].id, "please add a unit test");
    await vi.runOnlyPendingTimersAsync();

    const output = await stepPromise;
    expect(output).toMatchObject({ approved: true, approvalNote: "please add a unit test" });
  });

  it("omits approvalNote in output when approved without a note", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep();
    const stepPromise = executeApprovalStep(step as never, makeContext() as never, ac.signal);

    const pending = testQueue.list("pending");
    approvePending(pending[0].id);
    await vi.runOnlyPendingTimersAsync();

    const output = await stepPromise;
    expect(output).toMatchObject({ approved: true });
    expect((output as { approvalNote?: unknown }).approvalNote).toBeUndefined();
  });
});

describe("executeApprovalStep – abort cleanup", () => {
  it("rejects the queue entry when the AbortSignal fires before approval", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep();
    const stepPromise = executeApprovalStep(step as never, makeContext() as never, ac.signal);

    ac.abort(new Error("run aborted"));

    await expect(stepPromise).rejects.toThrow(/aborted/);
    const pending = testQueue.list("pending");
    expect(pending).toHaveLength(0);
    const rejected = testQueue.list("rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].rejectionReason).toBe("run aborted");
  });
});

describe("executeApprovalStep – workflow.approval.expired event", () => {
  it("emits workflow.approval.expired with resolution=deny when timeout auto-denies", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep({ timeoutMs: 1, defaultResolution: "deny", reason: "Gate check" });
    const ctx = makeContext();
    const stepPromise = executeApprovalStep(step as never, ctx as never, ac.signal);
    const rejectedStep = expect(stepPromise).rejects.toThrow(/expired/);

    // Simulate timeout: expire the pending item before advancing its poll interval.
    vi.advanceTimersByTime(10);
    const pending = testQueue.list("pending");
    expect(pending).toHaveLength(1);
    testQueue.expireStale(1); // ttl=1ms means everything is stale
    await vi.runOnlyPendingTimersAsync();

    await rejectedStep;

    const expiredCalls = mockEmit.mock.calls.filter(([event]) => event === "workflow.approval.expired");
    expect(expiredCalls).toHaveLength(1);
    expect(expiredCalls[0][1]).toMatchObject({
      workflowName: "test-wf",
      runId: "run-1",
      stepId: "gate",
      resolution: "deny",
      reason: "Gate check",
    });
  });

  it("does not emit workflow.approval.expired on manual approval", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep();
    const ctx = makeContext();
    const stepPromise = executeApprovalStep(step as never, ctx as never, ac.signal);

    const pending = testQueue.list("pending");
    approvePending(pending[0].id);
    await vi.runOnlyPendingTimersAsync();

    await stepPromise;

    const expiredCalls = mockEmit.mock.calls.filter(([event]) => event === "workflow.approval.expired");
    expect(expiredCalls).toHaveLength(0);
  });

  it("does not emit workflow.approval.expired on manual rejection", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep();
    const ctx = makeContext();
    const stepPromise = executeApprovalStep(step as never, ctx as never, ac.signal);
    const rejectedStep = expect(stepPromise).rejects.toThrow(/rejected/);

    const pending = testQueue.list("pending");
    testQueue.reject(pending[0].id, "not now");
    await vi.runOnlyPendingTimersAsync();

    await rejectedStep;

    const expiredCalls = mockEmit.mock.calls.filter(([event]) => event === "workflow.approval.expired");
    expect(expiredCalls).toHaveLength(0);
  });
});
