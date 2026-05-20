import type { AgentDef } from "#core/agents/agent-types.js";
import { loadConfig } from "#core/config/config.js";
import { assess, nonInteractiveConfig, type Policy } from "#core/tools/guardrails.js";
import { getToolEffect } from "#core/tools/index.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { assertOutboundGitHubCommentBodyIsSafe } from "#modules/autonomy/github-comment-safety.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_HARNESS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import type { GitHubPullRequestEventPayload } from "#modules/github-webhook/events.js";

const COMMENT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REVIEW_COMMENT_BODY_CHARS = 4_000;
const REVIEW_TRUNCATION_NOTICE = "\n\n[Review truncated]";

export const agent: AgentDef = {
  name: "pr-reviewer",
  role: "Draft advisory review feedback for KOTA-created pull requests relative to the task's Done When criteria.",
  promptPath: "src/modules/autonomy/workflows/pr-reviewer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  // The reviewer is passive. It drafts structured output only; the workflow's
  // approval and github_comment steps own the external write.
  writeScope: [],
};

type PrWebhookPayload = Partial<GitHubPullRequestEventPayload>;
type PrReviewRecommendation = "approve" | "request-changes";

export type PrReviewDraft = {
  recommendation: PrReviewRecommendation;
  body: string;
};

export type PreparedPrReviewComment = {
  repo: string;
  prNumber: number;
  recommendation: PrReviewRecommendation;
  body: string;
};

type PrReviewCommentPolicy = {
  approvalRequired: boolean;
  policy: Policy;
  reason: string;
};

export type PrReviewAssessment =
  | { skip: true; skipReason: string }
  | {
      skip: false;
      repo: string;
      prNumber: number;
      headBranch: string;
      baseBranch: string;
      title: string;
    };

const REVIEWABLE_ACTIONS = new Set(["opened", "synchronize"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isKotaTaskBranch(branch: unknown): branch is string {
  return typeof branch === "string" && branch.startsWith("kota/task/");
}

function isReviewRecommendation(value: unknown): value is PrReviewRecommendation {
  return value === "approve" || value === "request-changes";
}

function skip(skipReason: string): PrReviewAssessment {
  return { skip: true, skipReason };
}

function assessActorIntegrity(p: PrWebhookPayload): string | null {
  if (p.actorIntegrity === "allowed") {
    return null;
  }
  if (p.actorIntegrity === "blocked_actor") {
    return `blocked actor: ${p.actorIntegrityReason ?? "webhook payload marked the actor as blocked"}`;
  }
  if (p.actorIntegrity === "low_trust_actor") {
    return `low-trust actor: ${p.actorIntegrityReason ?? "webhook payload did not meet the trust threshold"}`;
  }
  if (p.actorIntegrity === "missing_metadata") {
    return `missing actor trust metadata: ${p.actorIntegrityReason ?? "webhook payload omitted actor integrity fields"}`;
  }
  return "missing actor trust metadata: webhook payload omitted actorIntegrity";
}

function validateReviewDraft(raw: Parameters<typeof expectStructuredOutput<PrReviewDraft>>[0]): PrReviewDraft {
  const obj = expectStructuredOutput<PrReviewDraft>(raw, ["recommendation", "body"]);
  if (!isReviewRecommendation(obj.recommendation)) {
    throw new Error("review output recommendation must be approve or request-changes");
  }
  if (!isNonEmptyString(obj.body)) {
    throw new Error("review output body must be a non-empty string");
  }
  assertOutboundGitHubCommentBodyIsSafe(obj.body);
  return {
    recommendation: obj.recommendation,
    body: obj.body,
  };
}

function validatePreparedComment(
  raw: Parameters<typeof expectStructuredOutput<PreparedPrReviewComment>>[0],
): PreparedPrReviewComment {
  const obj = expectStructuredOutput<PreparedPrReviewComment>(raw, [
    "repo",
    "prNumber",
    "recommendation",
    "body",
  ]);
  if (!isNonEmptyString(obj.repo)) throw new Error("prepared review comment missing repo");
  if (typeof obj.prNumber !== "number") {
    throw new Error("prepared review comment missing PR number");
  }
  if (!isReviewRecommendation(obj.recommendation)) {
    throw new Error("prepared review comment recommendation must be approve or request-changes");
  }
  if (!isNonEmptyString(obj.body)) {
    throw new Error("prepared review comment missing body");
  }
  assertOutboundGitHubCommentBodyIsSafe(obj.body);
  return {
    repo: obj.repo,
    prNumber: obj.prNumber,
    recommendation: obj.recommendation,
    body: obj.body,
  };
}

function validateCommentPolicy(
  raw: Parameters<typeof expectStructuredOutput<PrReviewCommentPolicy>>[0],
): PrReviewCommentPolicy {
  const obj = expectStructuredOutput<PrReviewCommentPolicy>(raw, [
    "approvalRequired",
    "policy",
    "reason",
  ]);
  if (typeof obj.approvalRequired !== "boolean") {
    throw new Error("comment policy approvalRequired must be boolean");
  }
  if (
    obj.policy !== "allow" &&
    obj.policy !== "confirm" &&
    obj.policy !== "deny" &&
    obj.policy !== "queue"
  ) {
    throw new Error(`comment policy has unexpected policy ${String(obj.policy)}`);
  }
  if (!isNonEmptyString(obj.reason)) {
    throw new Error("comment policy reason must be a non-empty string");
  }
  return {
    approvalRequired: obj.approvalRequired,
    policy: obj.policy,
    reason: obj.reason,
  };
}

function boundedReviewBody(draft: PrReviewDraft): string {
  const prefix = `**Recommendation:** ${draft.recommendation}\n\n`;
  const body = draft.body.trim();
  const full = `${prefix}${body}`;
  if (full.length <= MAX_REVIEW_COMMENT_BODY_CHARS) return full;

  const bodyBudget =
    MAX_REVIEW_COMMENT_BODY_CHARS -
    prefix.length -
    REVIEW_TRUNCATION_NOTICE.length;
  if (bodyBudget < 1) {
    throw new Error("review comment bound is too small for the deterministic prefix");
  }
  return `${prefix}${body.slice(0, bodyBudget).trimEnd()}${REVIEW_TRUNCATION_NOTICE}`;
}

function githubCommentInput(comment: PreparedPrReviewComment): Record<string, unknown> {
  return {
    repo: comment.repo,
    number: comment.prNumber,
    body: comment.body,
  };
}

function assessCommentPolicy(
  projectDir: string,
  input: Record<string, unknown>,
): PrReviewCommentPolicy {
  if (getToolEffect("github_comment") === undefined) {
    return {
      approvalRequired: true,
      policy: "queue",
      reason: "github_comment is not registered, so the workflow keeps the approval gate closed",
    };
  }
  const config = nonInteractiveConfig(loadConfig(projectDir).guardrails);
  const assessment = assess("github_comment", input, config);
  if (assessment.policy === "deny") {
    throw new Error(`github_comment is denied by guardrails: ${assessment.reason}`);
  }
  return {
    approvalRequired: assessment.policy === "queue" || assessment.policy === "confirm",
    policy: assessment.policy,
    reason: assessment.reason,
  };
}

function didStepSucceed(ctx: WorkflowStepContext, stepId: string): boolean {
  return ctx.stepResults[stepId]?.status === "success";
}

function canPostComment(ctx: WorkflowStepContext): boolean {
  if (!didStepSucceed(ctx, "prepare-comment")) return false;
  const policy = commentPolicy.outputRequired(ctx);
  return !policy.approvalRequired || didStepSucceed(ctx, "approve-comment");
}

const assessPr = typedCodeStep<PrReviewAssessment>({
  id: "assess-pr",
  type: "code",
  validate: (raw): PrReviewAssessment => {
    const obj = expectStructuredOutput<{ skip: boolean }>(raw, ["skip"]);
    if (typeof obj.skip !== "boolean") {
      throw new Error(`expected skip: boolean, got ${typeof obj.skip}`);
    }
    return raw as PrReviewAssessment;
  },
  run: ({ trigger }) => {
    const p = trigger.payload as PrWebhookPayload;

    if (!isNonEmptyString(p.action) || !REVIEWABLE_ACTIONS.has(p.action)) {
      return skip(`irrelevant action '${String(p.action)}' is not reviewable`);
    }
    if (!isKotaTaskBranch(p.headBranch)) {
      return skip(`non-KOTA branch '${String(p.headBranch)}' is not a kota/task/* branch`);
    }
    if (p.isFork === true) {
      return skip("fork PR is not eligible for automated review");
    }
    if (p.isFork !== false) {
      return skip("missing explicit fork status in webhook payload");
    }
    const actorIntegritySkipReason = assessActorIntegrity(p);
    if (actorIntegritySkipReason) {
      return skip(actorIntegritySkipReason);
    }
    if (!isNonEmptyString(p.repo) || typeof p.number !== "number") {
      return skip("missing repo or PR number in webhook payload");
    }
    if (!isNonEmptyString(p.baseBranch) || !isNonEmptyString(p.title)) {
      return skip("missing base branch or title in webhook payload");
    }

    return {
      skip: false,
      repo: p.repo,
      prNumber: p.number,
      headBranch: p.headBranch,
      baseBranch: p.baseBranch,
      title: p.title,
    };
  },
});

const prepareComment = typedCodeStep<PreparedPrReviewComment>({
  id: "prepare-comment",
  type: "code",
  validate: validatePreparedComment,
  when: stepSucceeded("review"),
  run: (ctx) => {
    const assessment = assessPr.outputRequired(ctx);
    if (assessment.skip) {
      throw new Error("cannot prepare a PR review comment for a skipped assessment");
    }
    const draft = validateReviewDraft(ctx.stepOutputs.review);
    const body = boundedReviewBody(draft);
    assertOutboundGitHubCommentBodyIsSafe(body);
    return {
      repo: assessment.repo,
      prNumber: assessment.prNumber,
      recommendation: draft.recommendation,
      body,
    };
  },
});

const commentPolicy = typedCodeStep<PrReviewCommentPolicy>({
  id: "comment-policy",
  type: "code",
  validate: validateCommentPolicy,
  when: stepSucceeded("prepare-comment"),
  run: (ctx) => {
    const comment = prepareComment.outputRequired(ctx);
    return assessCommentPolicy(ctx.projectDir, githubCommentInput(comment));
  },
});

// Not recovery-capable: runs on github.pull_request webhooks and does not touch
// the local worktree. Its only side effect is an external GitHub comment after
// the configured policy allows the deterministic write path, so crash recovery
// cannot safely replay the write path without duplicate risk.
const prReviewerWorkflow: WorkflowDefinitionInput = {
  name: "pr-reviewer",
  description: "Review KOTA-created pull requests and post one bounded advisory PR comment.",
  tags: ["monitored"],
  defaultAutonomyMode: "passive",
  triggers: [
    {
      event: "github.pull_request",
    },
  ],
  steps: [
    assessPr,
    {
      id: "review",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      harness: AUTONOMY_AGENT_HARNESS,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: agent.effort,
      allowedTools: ["Read", "LS", "Grep", "Glob", "github_get_pr", "github_list_prs"],
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => !assessPr.outputRequired(ctx).skip,
      outputFormat: "json",
      outputSchema: {
        type: "object",
        required: ["recommendation", "body"],
        additionalProperties: false,
        properties: {
          recommendation: {
            type: "string",
            enum: ["approve", "request-changes"],
          },
          body: {
            type: "string",
          },
        },
      },
      validate: validateReviewDraft,
    },
    prepareComment,
    commentPolicy,
    {
      id: "approve-comment",
      type: "approval",
      timeoutMs: COMMENT_APPROVAL_TIMEOUT_MS,
      defaultResolution: "deny",
      reason: "Approve posting one bounded KOTA PR review comment to the originating GitHub pull request.",
      when: (ctx) =>
        stepSucceeded("comment-policy")(ctx) &&
        commentPolicy.outputRequired(ctx).approvalRequired,
    },
    {
      id: "post-comment",
      type: "tool",
      tool: "github_comment",
      when: canPostComment,
      input: (ctx) => {
        const comment = prepareComment.outputRequired(ctx);
        return githubCommentInput(comment);
      },
    },
    {
      id: "emit-review-posted",
      type: "emit",
      when: stepSucceeded("post-comment"),
      event: "workflow.pr.review.posted",
      payload: (ctx) => {
        const comment = prepareComment.outputRequired(ctx);
        return {
          prNumber: comment.prNumber,
          repo: comment.repo,
          recommendation: comment.recommendation,
        };
      },
    },
  ],
};

export default prReviewerWorkflow;
