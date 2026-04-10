import { describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import prReviewerWorkflow from "./workflow.js";

type PrPayload = {
  repo?: string | null;
  action?: string | null;
  number?: number | null;
  title?: string | null;
  headBranch?: string | null;
  baseBranch?: string | null;
  isFork?: boolean | null;
};

function makeTrigger(overrides: PrPayload = {}) {
  return {
    event: "github.pull_request",
    payload: {
      repo: "owner/repo",
      action: "opened",
      number: 42,
      title: "Add feature X",
      headBranch: "kota/task/task-feature-x",
      baseBranch: "main",
      isFork: false,
      ...overrides,
    },
  };
}

describe("pr-reviewer workflow — assess-pr step", () => {
  it("skips when action is not opened or synchronize", async () => {
    const harness = new WorkflowTestHarness(prReviewerWorkflow, {
      trigger: makeTrigger({ action: "closed" }),
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-pr"].output).toMatchObject({ skip: true });
    expect(result.steps["assess-pr"].output).toMatchObject({
      skipReason: expect.stringContaining("action 'closed'"),
    });
    expect(result.steps.review.status).toBe("skipped");
    expect(result.steps["emit-review-posted"].status).toBe("skipped");
  });

  it("skips when action is labeled (non-reviewable)", async () => {
    const harness = new WorkflowTestHarness(prReviewerWorkflow, {
      trigger: makeTrigger({ action: "labeled" }),
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({ skip: true });
    expect(result.steps.review.status).toBe("skipped");
  });

  it("skips when headBranch does not match kota/task/*", async () => {
    const harness = new WorkflowTestHarness(prReviewerWorkflow, {
      trigger: makeTrigger({ headBranch: "feature/some-other-branch" }),
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: true,
      skipReason: expect.stringContaining("not a kota/task/*"),
    });
    expect(result.steps.review.status).toBe("skipped");
  });

  it("skips when headBranch is null", async () => {
    const harness = new WorkflowTestHarness(prReviewerWorkflow, {
      trigger: makeTrigger({ headBranch: null }),
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({ skip: true });
    expect(result.steps.review.status).toBe("skipped");
  });

  it("skips when PR is from a fork", async () => {
    const harness = new WorkflowTestHarness(prReviewerWorkflow, {
      trigger: makeTrigger({ isFork: true }),
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: true,
      skipReason: expect.stringContaining("fork"),
    });
    expect(result.steps.review.status).toBe("skipped");
  });

  it("does not skip when action is synchronize and branch is kota/task/*", async () => {
    const harness = new WorkflowTestHarness(prReviewerWorkflow, {
      trigger: makeTrigger({ action: "synchronize" }),
      stepMocks: {
        review: { turns: [], totalCostUsd: 0.03 },
      },
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: false,
      prNumber: 42,
      repo: "owner/repo",
      headBranch: "kota/task/task-feature-x",
    });
    expect(result.steps.review.status).toBe("success");
  });

  it("runs review when action is opened and branch is kota/task/*", async () => {
    const harness = new WorkflowTestHarness(prReviewerWorkflow, {
      trigger: makeTrigger(),
      stepMocks: {
        review: { turns: [], totalCostUsd: 0.05 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: false,
      repo: "owner/repo",
      prNumber: 42,
      headBranch: "kota/task/task-feature-x",
    });
    expect(result.steps.review.status).toBe("success");
    expect(result.steps["emit-review-posted"].status).toBe("success");
  });

  it("emits workflow.pr.review.posted after successful review", async () => {
    const harness = new WorkflowTestHarness(prReviewerWorkflow, {
      trigger: makeTrigger(),
      stepMocks: {
        review: { turns: [], totalCostUsd: 0.05 },
      },
    });

    const result = await harness.run();

    const emitted = result.emitted.find((e) => e.event === "workflow.pr.review.posted");
    expect(emitted).toBeDefined();
    expect(emitted?.payload).toMatchObject({
      prNumber: 42,
      repo: "owner/repo",
    });
  });

  it("does not emit when review is skipped", async () => {
    const harness = new WorkflowTestHarness(prReviewerWorkflow, {
      trigger: makeTrigger({ action: "closed" }),
    });

    const result = await harness.run();

    const emitted = result.emitted.find((e) => e.event === "workflow.pr.review.posted");
    expect(emitted).toBeUndefined();
  });

  it("proceeds when isFork is null — treats absent head.repo as non-fork (safe default)", async () => {
    // isFork=null means the webhook didn't include head.repo info — treat as non-fork (safe default)
    const harness = new WorkflowTestHarness(prReviewerWorkflow, {
      trigger: makeTrigger({ isFork: null }),
      stepMocks: {
        review: { turns: [], totalCostUsd: 0.02 },
      },
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({ skip: false });
    expect(result.steps.review.status).toBe("success");
  });
});
