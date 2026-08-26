import type { AgentDef } from "#core/agents/agent-types.js";
import { typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { assertOutboundGitHubCommentBodyIsSafe } from "#modules/autonomy/github-comment-safety.js";
import { isGitHubImplementationRequest } from "#modules/autonomy/github-mention-classification.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { inboundSignalWorkflowTargeted } from "#modules/inbound-signals/events.js";
import {
  assessActorIntegrity,
  boundedBody,
  GITHUB_MENTION_INTAKE_COMMENT_REQUESTED_EVENT,
  type GithubMentionAssessment,
  isNonEmptyString,
  mentionPayloadFromTrigger,
  normalizedFields,
  type PreparedGithubMentionComment,
  skip,
  validateAssessment,
  validatePreparedComment,
  validateResponseDraft,
} from "./workflow-contracts.js";

export type {
  GithubMentionAssessment,
  PreparedGithubMentionComment,
} from "./workflow-contracts.js";

const COMMENT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export const agent: AgentDef = {
  name: "github-mention-responder",
  role: "Draft a bounded single-turn response to a trusted GitHub issue or pull request mention.",
  promptPath: "src/modules/autonomy/workflows/github-mention-responder/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  // The response agent cannot mutate the worktree. The only external write is
  // the separate github_comment tool step after approval.
  writeScope: "deny-all",
};

const assessMention = typedCodeStep<GithubMentionAssessment>({
  id: "assess-mention",
  type: "code",
  validate: validateAssessment,
  run: ({ trigger }) => {
    if (trigger.event === GITHUB_MENTION_INTAKE_COMMENT_REQUESTED_EVENT) {
      const comment = validatePreparedComment(trigger.payload);
      return {
        decision: "prepared",
        agentEligible: false,
        commentEligible: true,
        comment,
      };
    }
    const p = mentionPayloadFromTrigger(trigger);

    if (!isNonEmptyString(p.action) || p.action !== "created") {
      return skip(`unsupported issue_comment action '${String(p.action)}'`);
    }

    const actorIntegritySkipReason = assessActorIntegrity(p);
    if (actorIntegritySkipReason) {
      return skip(actorIntegritySkipReason);
    }

    const fields = normalizedFields(p);
    if ("skipReason" in fields) {
      return skip(fields.skipReason);
    }

    if (isGitHubImplementationRequest(fields.commentBody)) {
      return skip("implementation request is routed to github-mention-intake");
    }

    return {
      decision: "respond",
      agentEligible: true,
      commentEligible: true,
      fields,
    };
  },
});

const prepareComment = typedCodeStep<PreparedGithubMentionComment>({
  id: "prepare-comment",
  type: "code",
  validate: validatePreparedComment,
  when: (ctx) => assessMention.outputRequired(ctx).commentEligible,
  run: (ctx) => {
    const assessment = assessMention.outputRequired(ctx);
    if (assessment.decision === "skip") {
      throw new Error("cannot prepare a comment for a skipped GitHub mention");
    }
    if (assessment.decision === "prepared") return assessment.comment;
    const draft = validateResponseDraft(ctx.stepOutputs["draft-response"]);
    const { body } = draft;
    const bounded = boundedBody(body);
    assertOutboundGitHubCommentBodyIsSafe(bounded);

    return {
      repo: assessment.fields.repo,
      issueNumber: assessment.fields.issueNumber,
      isPullRequest: assessment.fields.isPullRequest,
      originalCommentId: assessment.fields.commentId,
      mode: "agent",
      body: bounded,
    };
  },
});

const githubMentionResponderWorkflow: WorkflowDefinitionInput = {
  name: "github-mention-responder",
  description: "Answer trusted GitHub issue or PR mention comments with one bounded response.",
  repository: "none",
  tags: ["monitored"],
  // The agent only drafts structured output. Native capable-tier harnesses
  // require autonomous mode; deny-all plus whole-step mutation enforcement
  // preserves the local read-only boundary before the approved tool step.
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      event: inboundSignalWorkflowTargeted,
    },
    {
      event: "github-mention-responder.requested",
    },
    {
      event: GITHUB_MENTION_INTAKE_COMMENT_REQUESTED_EVENT,
    },
  ],
  steps: [
    assessMention,
    {
      id: "draft-response",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => assessMention.outputRequired(ctx).agentEligible,
      outputFormat: "json",
      outputSchema: {
        type: "object",
        required: ["body"],
        properties: {
          body: {
            type: "string",
          },
        },
      },
      validate: validateResponseDraft,
    },
    prepareComment,
    {
      id: "approve-comment",
      type: "approval",
      timeoutMs: COMMENT_APPROVAL_TIMEOUT_MS,
      defaultResolution: "deny",
      reason: "Approve posting one bounded KOTA response comment to the originating GitHub issue or pull request.",
      when: stepSucceeded("prepare-comment"),
    },
    {
      id: "post-comment",
      type: "tool",
      tool: "github_comment",
      when: stepSucceeded("approve-comment"),
      input: (ctx) => {
        const comment = prepareComment.outputRequired(ctx);
        return {
          repo: comment.repo,
          number: comment.issueNumber,
          body: comment.body,
        };
      },
    },
    {
      id: "emit-response-posted",
      type: "emit",
      when: stepSucceeded("post-comment"),
      event: "workflow.github-mention.response.posted",
      payload: (ctx) => {
        const comment = prepareComment.outputRequired(ctx);
        return {
          repo: comment.repo,
          issueNumber: comment.issueNumber,
          isPullRequest: comment.isPullRequest,
          originalCommentId: comment.originalCommentId,
          mode: comment.mode,
          idempotencyKey:
            `github-mention-posted:${comment.repo}:${comment.originalCommentId}:${comment.mode}`,
        };
      },
    },
  ],
};

export default githubMentionResponderWorkflow;
