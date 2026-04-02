import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue, resetApprovalQueue } from "../approval-queue.js";
import { WorkflowTestHarness } from "../workflow-testing/index.js";
import { executeApprovalStep } from "./step-executor-approval.js";
import type { WorkflowApprovalStepInput, WorkflowDefinitionInput } from "./types.js";

vi.mock("../event-bus.js", () => ({ tryEmit: vi.fn() }));

let testQueue: ApprovalQueue;
vi.mock("../approval-queue.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../approval-queue.js")>();
  return { ...mod, getApprovalQueue: () => testQueue };
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "approval-step-test-"));
  testQueue = new ApprovalQueue(tmpDir);
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
    expect(result.steps["confirm"].status).toBe("success");
    expect(result.steps["confirm"].output).toMatchObject({ approved: true, resolutionSource: "harness" });
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
    expect(result.steps["confirm"].status).toBe("success");
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
    expect(result.steps["confirm"].status).toBe("failed");
    expect(result.steps["confirm"].error).toContain("rejected");
    expect(result.steps["confirm"].error).toContain("Too risky");
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
    expect(result.steps["confirm"].status).toBe("failed");
    expect(result.steps["next"].status).toBe("success");
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
    expect(result.steps["confirm"].status).toBe("skipped");
  });
});
