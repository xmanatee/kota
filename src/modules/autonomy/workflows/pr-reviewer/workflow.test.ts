import { describe, expect, it, vi } from "vitest";
import type { ToolResult } from "#core/tools/tool-result.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import type { GitHubWebhookActorIntegrity } from "#modules/github-webhook/events.js";
import prReviewerWorkflow from "./workflow.js";

type PrPayload = {
  repo?: string | null;
  action?: string | null;
  number?: number | null;
  title?: string | null;
  headBranch?: string | null;
  baseBranch?: string | null;
  headSha?: string | null;
  isFork?: boolean | null;
  actorIntegrity?: GitHubWebhookActorIntegrity | null;
  actorIntegrityReason?: string | null;
};

function makeTrigger(overrides: PrPayload = {}) {
  return {
    event: "github.pull_request",
    schemaRef: null, payload: {
      repo: "owner/repo",
      action: "opened",
      number: 42,
      title: "Add feature X",
      headBranch: "feature/semantic-review",
      baseBranch: "main",
      isFork: false,
      headSha: "abc123",
      sender: { login: "maintainer", type: "User" },
      prAuthor: { login: "kota-bot", type: "Bot" },
      authorAssociation: "MEMBER",
      actorIntegrity: "allowed",
      actorIntegrityReason: "author association 'MEMBER' satisfies the configured trust threshold",
      ...overrides,
    },
  };
}

function reviewDraft(overrides: { recommendation?: string; body?: string } = {}) {
  return {
    recommendation: overrides.recommendation ?? "approve",
    body: overrides.body ?? "Summary: the pull request's stated intent is covered.",
  };
}

function toolSpy(): {
  runTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  calls: Array<{ name: string; input: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    runTool: vi.fn(async (name, input) => {
      calls.push({ name, input });
      return { content: "Comment posted (ID: 999)" };
    }),
  };
}

describe("pr-reviewer workflow — assess-pr step", () => {

  it("skips when action is not opened or synchronize", async () => {
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger({ action: "closed" }),
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-pr"].output).toMatchObject({ skip: true });
    expect(result.steps["assess-pr"].output).toMatchObject({
      skipReason: expect.stringContaining("irrelevant action 'closed'"),
    });
    expect(result.steps.review.status).toBe("skipped");
  });

  it("skips when headBranch is null", async () => {
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger({ headBranch: null }),
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({ skip: true });
    expect(result.steps.review.status).toBe("skipped");
  });

  it("skips when the head SHA is missing", async () => {
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger({ headSha: null }),
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: true,
      skipReason: expect.stringContaining("head SHA"),
    });
    expect(result.steps.review.status).toBe("skipped");
  });

  it("skips when PR is from a fork", async () => {
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger({ isFork: true }),
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: true,
      skipReason: expect.stringContaining("fork PR"),
    });
    expect(result.steps.review.status).toBe("skipped");
  });

  it("skips low-trust same-repository PRs before review", async () => {
    const tools = toolSpy();
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger({
        actorIntegrity: "low_trust_actor",
        actorIntegrityReason: "author association 'FIRST_TIMER' is below the configured trust threshold",
      }),
      ports: {
        runTool: tools.runTool,
      },
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: true,
      skipReason: expect.stringContaining("low-trust actor"),
    });
    expect(result.steps.review.status).toBe("skipped");
    expect(tools.calls).toEqual([]);
  });

  it("skips configured blocked actors before review", async () => {
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger({
        actorIntegrity: "blocked_actor",
        actorIntegrityReason: "blocked actor 'blocked-user' matched github-webhook actorIntegrity.blockedActors",
      }),
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: true,
      skipReason: expect.stringContaining("blocked actor"),
    });
    expect(result.steps.review.status).toBe("skipped");
  });

  it("skips when actor integrity metadata is missing", async () => {
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger({ actorIntegrity: null, actorIntegrityReason: null }),
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: true,
      skipReason: expect.stringContaining("missing actor trust metadata"),
    });
    expect(result.steps.review.status).toBe("skipped");
  });

  it("reviews a synchronize event without imposing a branch naming convention", async () => {
    const tools = toolSpy();
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger({ action: "synchronize" }),
      approvals: { "approve-comment": { decision: "approve" } },
      stepOutputs: {
        review: reviewDraft(),
      },
      ports: {
        runTool: tools.runTool,
      },
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: false,
      prNumber: 42,
      repo: "owner/repo",
      headBranch: "feature/semantic-review",
      headSha: "abc123",
    });
    expect(result.steps.review.status).toBe("success");
    expect(tools.calls).toHaveLength(1);
  });

  it("reviews an opened trusted same-repository PR", async () => {
    const tools = toolSpy();
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger(),
      approvals: { "approve-comment": { decision: "approve" } },
      stepOutputs: {
        review: reviewDraft(),
      },
      ports: {
        runTool: tools.runTool,
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: false,
      repo: "owner/repo",
      prNumber: 42,
      headBranch: "feature/semantic-review",
      headSha: "abc123",
    });
    expect(result.steps.review.status).toBe("success");
    expect(result.steps["prepare-comment"].output).toMatchObject({
      repo: "owner/repo",
      prNumber: 42,
      recommendation: "approve",
      body: "**Recommendation:** approve\n\nSummary: the pull request's stated intent is covered.",
    });
    expect(result.steps["comment-policy"].output).toMatchObject({
      approvalRequired: true,
      policy: "queue",
    });
    expect(tools.calls).toEqual([
      {
        name: "github_comment",
        input: {
          repo: "owner/repo",
          number: 42,
          body: "**Recommendation:** approve\n\nSummary: the pull request's stated intent is covered.",
        },
      },
    ]);
  });

  it("emits workflow.pr.review.posted after successful review", async () => {
    const tools = toolSpy();
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger(),
      approvals: { "approve-comment": { decision: "approve" } },
      stepOutputs: {
        review: reviewDraft(),
      },
      ports: {
        runTool: tools.runTool,
      },
    });

    const result = await harness.run();

    const emitted = result.emitted.find((e) => e.event === "workflow.pr.review.posted");
    expect(emitted).toBeDefined();
    expect(emitted?.payload).toMatchObject({
      prNumber: 42,
      repo: "owner/repo",
      recommendation: "approve",
    });
  });

  it("fails malformed review output before any GitHub comment write", async () => {
    const tools = toolSpy();
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger(),
      approvals: { "approve-comment": { decision: "approve" } },
      stepOutputs: {
        review: reviewDraft({ recommendation: "maybe" }),
      },
      ports: {
        runTool: tools.runTool,
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps.review.status).toBe("failed");
    expect(result.steps.review.output).toBeUndefined();
    expect(result.steps.review.error).toContain(
      'payload.recommendation: expected one of "approve" | "request-changes"',
    );
    expect(result.steps["prepare-comment"]).toBeUndefined();
    expect(result.steps["post-comment"]).toBeUndefined();
    expect(tools.calls).toEqual([]);
  });

  it("fails empty review output before any GitHub comment write", async () => {
    const tools = toolSpy();
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger(),
      stepOutputs: {
        review: reviewDraft({ body: "   " }),
      },
      ports: {
        runTool: tools.runTool,
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps.review.status).toBe("failed");
    expect(result.steps.review.output).toBeUndefined();
    expect(result.steps.review.error).toContain("body must be a non-empty string");
    expect(result.steps["prepare-comment"]).toBeUndefined();
    expect(result.steps["post-comment"]).toBeUndefined();
    expect(tools.calls).toEqual([]);
  });

  it("blocks suspected tokens from review output before persisting the agent body or writing a GitHub comment", async () => {
    const tools = toolSpy();
    const token = `${"ghp"}_${"A".repeat(36)}`;
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger(),
      stepOutputs: {
        review: reviewDraft({ body: `This should never be posted: ${token}` }),
      },
      ports: {
        runTool: tools.runTool,
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps.review.status).toBe("failed");
    expect(result.steps.review.output).toBeUndefined();
    expect(result.steps.review.error).toContain("github-token");
    expect(result.steps.review.error).not.toContain(token);
    expect(result.steps["prepare-comment"]).toBeUndefined();
    expect(result.steps["post-comment"]).toBeUndefined();
    expect(tools.calls).toEqual([]);
  });

  it("bounds oversized review text before posting one GitHub comment", async () => {
    const tools = toolSpy();
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger(),
      approvals: { "approve-comment": { decision: "approve" } },
      stepOutputs: {
        review: reviewDraft({
          recommendation: "request-changes",
          body: `Blocking issue:\n\n${"x".repeat(5_000)}`,
        }),
      },
      ports: {
        runTool: tools.runTool,
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(tools.calls).toHaveLength(1);
    const body = tools.calls[0].input.body;
    expect(typeof body).toBe("string");
    expect((body as string).length).toBeLessThanOrEqual(4_000);
    expect(body).toContain("**Recommendation:** request-changes");
    expect(body).toContain("[Review truncated]");
  });

  it("does not emit when review is skipped", async () => {
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger({ action: "closed" }),
    });

    const result = await harness.run();

    const emitted = result.emitted.find((e) => e.event === "workflow.pr.review.posted");
    expect(emitted).toBeUndefined();
  });

  it("skips when explicit fork status is missing", async () => {
    const harness = new WorkflowScenarioDriver(prReviewerWorkflow, {
      trigger: makeTrigger({ isFork: null }),
    });

    const result = await harness.run();

    expect(result.steps["assess-pr"].output).toMatchObject({
      skip: true,
      skipReason: expect.stringContaining("fork status"),
    });
    expect(result.steps.review.status).toBe("skipped");
  });
});
