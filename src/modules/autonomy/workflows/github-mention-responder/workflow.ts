import type { AgentDef } from "#core/agents/agent-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { assertOutboundGitHubCommentBodyIsSafe } from "#modules/autonomy/github-comment-safety.js";
import { isGitHubImplementationRequest } from "#modules/autonomy/github-mention-classification.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_HARNESS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import type {
  GitHubIssueCommentMentionEventPayload,
  GitHubWebhookActor,
} from "#modules/github-webhook/events.js";
import { githubIssueCommentMentionFromInboundSignal } from "#modules/github-webhook/inbound-signal.js";
import {
  type InboundSignalReceivedPayload,
  inboundSignalReceived,
} from "#modules/inbound-signals/events.js";

const COMMENT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_COMMENT_BODY_CHARS = 4_000;

export const agent: AgentDef = {
  name: "github-mention-responder",
  role: "Draft a bounded single-turn response to a trusted GitHub issue or pull request mention.",
  promptPath: "src/modules/autonomy/workflows/github-mention-responder/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  // The response agent is passive and cannot mutate the worktree. The only
  // external write is the separate github_comment tool step after approval.
  writeScope: [],
};

type MentionWebhookPayload = Partial<GitHubIssueCommentMentionEventPayload>;

type NormalizedMentionFields = {
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  isPullRequest: boolean;
  commentId: number;
  commentBody: string;
  commentUrl: string;
  commenter: { login: string; type: string };
  sender: { login: string; type: string };
  authorAssociation: string;
  matchedMentionAlias: string;
  actorIntegrityReason: string;
};

export type GithubMentionAssessment =
  | {
      decision: "skip";
      agentEligible: false;
      commentEligible: false;
      skipReason: string;
    }
  | {
      decision: "respond";
      agentEligible: true;
      commentEligible: true;
      fields: NormalizedMentionFields;
    };

export type PreparedGithubMentionComment = {
  repo: string;
  issueNumber: number;
  isPullRequest: boolean;
  originalCommentId: number;
  mode: "agent";
  body: string;
};

type GithubMentionResponseDraft = {
  body: string;
};

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function mentionPayloadFromTrigger(
  trigger: { event: string; payload: object },
): MentionWebhookPayload {
  if (trigger.event !== inboundSignalReceived.name) return {};
  return githubIssueCommentMentionFromInboundSignal(
    trigger.payload as InboundSignalReceivedPayload,
  );
}

function hasCompleteActor(actor: GitHubWebhookActor | undefined): actor is { login: string; type: string } {
  return isNonEmptyString(actor?.login) && isNonEmptyString(actor?.type);
}

function skip(skipReason: string): GithubMentionAssessment {
  return {
    decision: "skip",
    agentEligible: false,
    commentEligible: false,
    skipReason,
  };
}

function assessActorIntegrity(p: MentionWebhookPayload): string | null {
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

function normalizedFields(p: MentionWebhookPayload): NormalizedMentionFields | { skipReason: string } {
  if (!isNonEmptyString(p.repo)) return { skipReason: "malformed mention payload: missing repo" };
  if (typeof p.issueNumber !== "number") {
    return { skipReason: "malformed mention payload: missing issue number" };
  }
  if (!isNonEmptyString(p.issueTitle)) {
    return { skipReason: "malformed mention payload: missing issue title" };
  }
  if (!isNonEmptyString(p.issueUrl)) {
    return { skipReason: "malformed mention payload: missing issue URL" };
  }
  if (typeof p.isPullRequest !== "boolean") {
    return { skipReason: "malformed mention payload: missing issue/PR kind" };
  }
  if (typeof p.commentId !== "number") {
    return { skipReason: "malformed mention payload: missing comment id" };
  }
  if (!isNonEmptyString(p.commentBody)) {
    return { skipReason: "malformed mention payload: missing comment body" };
  }
  if (!isNonEmptyString(p.commentUrl)) {
    return { skipReason: "malformed mention payload: missing comment URL" };
  }
  if (!hasCompleteActor(p.commenter)) {
    return { skipReason: "malformed mention payload: missing commenter metadata" };
  }
  if (!hasCompleteActor(p.sender)) {
    return { skipReason: "malformed mention payload: missing sender metadata" };
  }
  if (!isNonEmptyString(p.authorAssociation)) {
    return { skipReason: "malformed mention payload: missing author association" };
  }
  if (!isNonEmptyString(p.matchedMentionAlias)) {
    return { skipReason: "malformed mention payload: missing matched mention alias" };
  }
  if (!isNonEmptyString(p.actorIntegrityReason)) {
    return { skipReason: "malformed mention payload: missing actor integrity reason" };
  }

  return {
    repo: p.repo,
    issueNumber: p.issueNumber,
    issueTitle: p.issueTitle,
    issueUrl: p.issueUrl,
    isPullRequest: p.isPullRequest,
    commentId: p.commentId,
    commentBody: p.commentBody,
    commentUrl: p.commentUrl,
    commenter: p.commenter,
    sender: p.sender,
    authorAssociation: p.authorAssociation,
    matchedMentionAlias: p.matchedMentionAlias,
    actorIntegrityReason: p.actorIntegrityReason,
  };
}

function validateNormalizedMentionFields(fields: NormalizedMentionFields | undefined): NormalizedMentionFields {
  if (!fields) throw new Error("mention assessment missing normalized fields");
  if (!isNonEmptyString(fields.repo)) throw new Error("mention assessment fields missing repo");
  if (typeof fields.issueNumber !== "number") throw new Error("mention assessment fields missing issue number");
  if (!isNonEmptyString(fields.issueTitle)) throw new Error("mention assessment fields missing issue title");
  if (!isNonEmptyString(fields.issueUrl)) throw new Error("mention assessment fields missing issue URL");
  if (typeof fields.isPullRequest !== "boolean") {
    throw new Error("mention assessment fields missing issue/PR kind");
  }
  if (typeof fields.commentId !== "number") throw new Error("mention assessment fields missing comment id");
  if (!isNonEmptyString(fields.commentBody)) throw new Error("mention assessment fields missing comment body");
  if (!isNonEmptyString(fields.commentUrl)) throw new Error("mention assessment fields missing comment URL");
  if (!hasCompleteActor(fields.commenter)) throw new Error("mention assessment fields missing commenter");
  if (!hasCompleteActor(fields.sender)) throw new Error("mention assessment fields missing sender");
  if (!isNonEmptyString(fields.authorAssociation)) {
    throw new Error("mention assessment fields missing author association");
  }
  if (!isNonEmptyString(fields.matchedMentionAlias)) {
    throw new Error("mention assessment fields missing matched mention alias");
  }
  if (!isNonEmptyString(fields.actorIntegrityReason)) {
    throw new Error("mention assessment fields missing actor integrity reason");
  }
  return fields;
}

function validateAssessment(raw: Parameters<typeof expectStructuredOutput<GithubMentionAssessment>>[0]): GithubMentionAssessment {
  const obj = expectStructuredOutput<{ decision: string }>(raw, ["decision"]);
  const assessment = raw as GithubMentionAssessment;
  if (obj.decision === "skip") {
    if (assessment.agentEligible !== false || assessment.commentEligible !== false) {
      throw new Error("skip assessment must disable agent and comment eligibility");
    }
    if (!isNonEmptyString(assessment.skipReason)) throw new Error("skip assessment missing reason");
    return assessment;
  }
  if (obj.decision === "respond") {
    if (assessment.agentEligible !== true || assessment.commentEligible !== true) {
      throw new Error("respond assessment must enable agent and comment eligibility");
    }
    validateNormalizedMentionFields(assessment.fields);
    return assessment;
  }
  throw new Error(`unexpected mention assessment decision: ${obj.decision}`);
}

function validatePreparedComment(
  raw: Parameters<typeof expectStructuredOutput<PreparedGithubMentionComment>>[0],
): PreparedGithubMentionComment {
  const obj = expectStructuredOutput<PreparedGithubMentionComment>(raw, [
    "repo",
    "issueNumber",
    "isPullRequest",
    "originalCommentId",
    "mode",
    "body",
  ]);
  if (!isNonEmptyString(obj.repo)) throw new Error("prepared comment missing repo");
  if (typeof obj.issueNumber !== "number") throw new Error("prepared comment missing issue number");
  if (typeof obj.isPullRequest !== "boolean") throw new Error("prepared comment missing issue/PR kind");
  if (typeof obj.originalCommentId !== "number") throw new Error("prepared comment missing original comment id");
  if (obj.mode !== "agent") {
    throw new Error(`prepared comment mode must be agent, got ${obj.mode}`);
  }
  if (!isNonEmptyString(obj.body)) throw new Error("prepared comment missing body");
  assertOutboundGitHubCommentBodyIsSafe(obj.body);
  return raw as PreparedGithubMentionComment;
}

function validateResponseDraft(
  raw: Parameters<typeof expectStructuredOutput<GithubMentionResponseDraft>>[0],
): GithubMentionResponseDraft {
  const obj = expectStructuredOutput<GithubMentionResponseDraft>(raw, ["body"]);
  if (!isNonEmptyString(obj.body)) {
    throw new Error("draft-response output must include non-empty body");
  }
  assertOutboundGitHubCommentBodyIsSafe(obj.body);
  return { body: obj.body };
}

function boundedBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length <= MAX_COMMENT_BODY_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_COMMENT_BODY_CHARS - 28).trimEnd()}\n\n[Response truncated]`;
}

const assessMention = typedCodeStep<GithubMentionAssessment>({
  id: "assess-mention",
  type: "code",
  validate: validateAssessment,
  run: ({ trigger }) => {
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

// Not recovery-capable: this workflow does not mutate the local worktree. Its
// side effect is an external GitHub comment after an explicit approval step, so
// crash recovery cannot safely replay the response path without duplicate risk.
const githubMentionResponderWorkflow: WorkflowDefinitionInput = {
  name: "github-mention-responder",
  description: "Answer trusted GitHub issue or PR mention comments with one bounded response.",
  tags: ["monitored"],
  defaultAutonomyMode: "passive",
  triggers: [
    {
      event: inboundSignalReceived.name,
      filter: { provider: "github", channel: "github.issue_comment" },
    },
  ],
  steps: [
    assessMention,
    {
      id: "draft-response",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      harness: AUTONOMY_AGENT_HARNESS,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: agent.effort,
      allowedTools: ["Read", "LS", "Grep", "Glob"],
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
        };
      },
    },
  ],
};

export default githubMentionResponderWorkflow;
