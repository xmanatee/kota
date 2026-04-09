import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue, resetApprovalQueue } from "../extensions/approval-queue/queue.js";
import { WorkflowTestHarness } from "../workflow-testing/index.js";
import { executeApprovalStep } from "./step-executor-approval.js";
import type { WorkflowApprovalStepInput, WorkflowDefinitionInput } from "./types.js";

const { mockTryEmit } = vi.hoisted(() => ({ mockTryEmit: vi.fn() }));
vi.mock("../event-bus.js", () => ({ tryEmit: mockTryEmit }));

let testQueue: ApprovalQueue;
vi.mock("../extensions/approval-queue/queue.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../extensions/approval-queue/queue.js")>();
  return { ...mod, getApprovalQueue: () => testQueue };
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "approval-step-test-"));
  testQueue = new ApprovalQueue(tmpDir);
  mockTryEmit.mockClear();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  resetApprovalQueue();
});

function makeContext() {
  return {
    projectDir: "/project",
    workflow: { name: "test-wf", definitionPath: "src/wf.ts", runId: "run-1", runDir: ".kota/runs/run-1", runDirPath: "/project/.kota/runs/run-1" },
    trigger: { event: "runtime.idle" as const, payload: {} },
    previousOutput: null,
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    runTool: () => Promise.reject(new Error("not used")),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
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

    // Let the executor enqueue and enter the poll loop, then approve with a note
    await new Promise((r) => setTimeout(r, 10));
    const pending = testQueue.list("pending");
    expect(pending).toHaveLength(1);
    testQueue.approve(pending[0].id, "please add a unit test");

    const output = await stepPromise;
    expect(output).toMatchObject({ approved: true, approvalNote: "please add a unit test" });
  });

  it("omits approvalNote in output when approved without a note", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep();
    const stepPromise = executeApprovalStep(step as never, makeContext() as never, ac.signal);

    await new Promise((r) => setTimeout(r, 10));
    const pending = testQueue.list("pending");
    testQueue.approve(pending[0].id);

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

    // Let the executor enqueue and enter the poll loop, then abort
    await new Promise((r) => setTimeout(r, 10));
    ac.abort(new Error("run aborted"));

    await expect(stepPromise).rejects.toThrow(/aborted/);
    const pending = testQueue.list("pending");
    expect(pending).toHaveLength(0);
    const rejected = testQueue.list("rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].rejectionReason).toBe("run aborted");
  });
});

function makeWorkflow(steps: WorkflowDefinitionInput["steps"]): WorkflowDefinitionInput {
  return {
    name: "test",
    triggers: [{ event: "runtime.idle" }],
    steps,
  };
}

describe("approval step – WorkflowTestHarness", () => {
  it("approves by default when no mock is provided", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        { id: "confirm", type: "approval", reason: "Deploy to prod?" } satisfies WorkflowApprovalStepInput,
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps.confirm.status).toBe("success");
    expect(result.steps.confirm.output).toMatchObject({ approved: true, resolutionSource: "harness" });
  });

  it("includes approvalNote in output when mock provides one", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        { id: "confirm", type: "approval" } satisfies WorkflowApprovalStepInput,
      ]),
      { stepMocks: { confirm: { approved: true, approvalNote: "add a test" } } },
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps.confirm.output).toMatchObject({ approved: true, approvalNote: "add a test" });
  });

  it("approves when mock is truthy (not a rejection object)", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        { id: "confirm", type: "approval" } satisfies WorkflowApprovalStepInput,
      ]),
      { stepMocks: { confirm: { approved: true } } },
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps.confirm.status).toBe("success");
  });

  it("rejects when mock has approved: false", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        { id: "confirm", type: "approval", reason: "Deploy?" } satisfies WorkflowApprovalStepInput,
      ]),
      { stepMocks: { confirm: { approved: false, reason: "Too risky" } } },
    );
    const result = await harness.run();
    expect(result.status).toBe("failed");
    expect(result.steps.confirm.status).toBe("failed");
    expect(result.steps.confirm.error).toContain("rejected");
    expect(result.steps.confirm.error).toContain("Too risky");
  });

  it("continues after rejection when continueOnFailure is true", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "confirm",
          type: "approval",
          continueOnFailure: true,
        } satisfies WorkflowApprovalStepInput,
        { id: "next", type: "code", run: () => "next-ran" },
      ]),
      { stepMocks: { confirm: { approved: false } } },
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps.confirm.status).toBe("failed");
    expect(result.steps.next.status).toBe("success");
  });

  it("skips the approval step when when-predicate is false", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "confirm",
          type: "approval",
          when: () => false,
        } satisfies WorkflowApprovalStepInput,
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps.confirm.status).toBe("skipped");
  });
});

describe("executeApprovalStep – workflow.approval.expired event", () => {
  it("emits workflow.approval.expired with resolution=deny when timeout auto-denies", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep({ timeoutMs: 1, defaultResolution: "deny", reason: "Gate check" });
    const ctx = makeContext();
    const stepPromise = executeApprovalStep(step as never, ctx as never, ac.signal);

    // Simulate timeout: expire the pending item
    await new Promise((r) => setTimeout(r, 10));
    const pending = testQueue.list("pending");
    expect(pending).toHaveLength(1);
    testQueue.expireStale(1); // ttl=1ms means everything is stale

    await expect(stepPromise).rejects.toThrow(/expired/);

    const expiredCalls = mockTryEmit.mock.calls.filter(([event]) => event === "workflow.approval.expired");
    expect(expiredCalls).toHaveLength(1);
    expect(expiredCalls[0][1]).toMatchObject({
      workflowName: "test-wf",
      runId: "run-1",
      stepId: "gate",
      resolution: "deny",
      reason: "Gate check",
    });
  });

  it("emits workflow.approval.expired with resolution=approve when timeout auto-approves", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep({ timeoutMs: 1, defaultResolution: "approve" });
    const ctx = makeContext();
    const stepPromise = executeApprovalStep(step as never, ctx as never, ac.signal);

    await new Promise((r) => setTimeout(r, 10));
    testQueue.expireStale(1);

    const output = await stepPromise;
    expect((output as { approved: boolean }).approved).toBe(true);

    const expiredCalls = mockTryEmit.mock.calls.filter(([event]) => event === "workflow.approval.expired");
    expect(expiredCalls).toHaveLength(1);
    expect(expiredCalls[0][1]).toMatchObject({
      workflowName: "test-wf",
      runId: "run-1",
      stepId: "gate",
      resolution: "approve",
    });
  });

  it("does not emit workflow.approval.expired on manual approval", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep();
    const ctx = makeContext();
    const stepPromise = executeApprovalStep(step as never, ctx as never, ac.signal);

    await new Promise((r) => setTimeout(r, 10));
    const pending = testQueue.list("pending");
    testQueue.approve(pending[0].id);

    await stepPromise;

    const expiredCalls = mockTryEmit.mock.calls.filter(([event]) => event === "workflow.approval.expired");
    expect(expiredCalls).toHaveLength(0);
  });

  it("does not emit workflow.approval.expired on manual rejection", async () => {
    const ac = new AbortController();
    const step = makeApprovalStep();
    const ctx = makeContext();
    const stepPromise = executeApprovalStep(step as never, ctx as never, ac.signal);

    await new Promise((r) => setTimeout(r, 10));
    const pending = testQueue.list("pending");
    testQueue.reject(pending[0].id, "not now");

    await expect(stepPromise).rejects.toThrow(/rejected/);

    const expiredCalls = mockTryEmit.mock.calls.filter(([event]) => event === "workflow.approval.expired");
    expect(expiredCalls).toHaveLength(0);
  });
});
