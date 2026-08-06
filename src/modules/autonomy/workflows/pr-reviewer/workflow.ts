import type { AgentDef } from "#core/agents/agent-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  assessPr,
  canPostComment,
  commentPolicy,
  githubCommentInput,
  prepareComment,
  validateReviewDraft,
} from "./workflow-steps.js";

export type {
  PreparedPrReviewComment,
  PrReviewAssessment,
  PrReviewDraft,
} from "./workflow-steps.js";

const COMMENT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export const agent: AgentDef = {
  name: "pr-reviewer",
  role: "Draft advisory review feedback for KOTA-created pull requests relative to the task's Done When criteria.",
  promptPath: "src/modules/autonomy/workflows/pr-reviewer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  // The reviewer drafts structured output only; the workflow's approval and
  // github_comment steps own the external write.
  writeScope: "deny-all",
};

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
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      autonomyMode: "autonomous",
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
