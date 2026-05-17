import type { AgentDef } from "#core/agents/agent-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
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
      decision: "unsupported";
      agentEligible: false;
      commentEligible: true;
      skipReason: string;
      fields: NormalizedMentionFields;
      responseBody: string;
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
  mode: "agent" | "unsupported";
  body: string;
};

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

function isImplementationRequest(body: string): boolean {
  return [
    /\b(implement|code|patch|modify|refactor)\b/i,
    /\b(fix|add|update|remove|delete|create)\b.+\b(file|code|feature|bug|test|branch|commit|pr|pull request)\b/i,
    /\b(open|make|submit)\b.+\b(pr|pull request|branch|commit)\b/i,
    /\b(push|commit)\b.+\b(change|code|fix|patch)\b/i,
  ].some((pattern) => pattern.test(body));
}

function unsupportedResponse(fields: NormalizedMentionFields): string {
  const surface = fields.isPullRequest ? `PR #${fields.issueNumber}` : `issue #${fields.issueNumber}`;
  return [
    `Thanks for the mention on ${surface}.`,
    "",
    "This GitHub mention entry point can answer bounded questions in-thread, but it cannot implement code changes, create branches, claim tasks, or run autonomous build work. Please open or link a normalized KOTA task for implementation work.",
  ].join("\n");
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
  if (obj.decision === "unsupported") {
    if (assessment.agentEligible !== false || assessment.commentEligible !== true) {
      throw new Error("unsupported assessment must disable agent and keep comment eligibility");
    }
    if (!isNonEmptyString(assessment.skipReason)) throw new Error("unsupported assessment missing reason");
    if (!isNonEmptyString(assessment.responseBody)) {
      throw new Error("unsupported assessment missing response body");
    }
    validateNormalizedMentionFields(assessment.fields);
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
  if (obj.mode !== "agent" && obj.mode !== "unsupported") {
    throw new Error(`prepared comment mode must be agent or unsupported, got ${obj.mode}`);
  }
  if (!isNonEmptyString(obj.body)) throw new Error("prepared comment missing body");
  return raw as PreparedGithubMentionComment;
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
    const p = trigger.payload as MentionWebhookPayload;

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

    if (isImplementationRequest(fields.commentBody)) {
      return {
        decision: "unsupported",
        agentEligible: false,
        commentEligible: true,
        skipReason: "implementation request is unsupported for GitHub mention responses",
        fields,
        responseBody: unsupportedResponse(fields),
      };
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
    if (assessment.decision === "unsupported") {
      return {
        repo: assessment.fields.repo,
        issueNumber: assessment.fields.issueNumber,
        isPullRequest: assessment.fields.isPullRequest,
        originalCommentId: assessment.fields.commentId,
        mode: "unsupported",
        body: boundedBody(assessment.responseBody),
      };
    }

    const draft = ctx.stepOutputs["draft-response"];
    if (draft === null || typeof draft !== "object" || Array.isArray(draft)) {
      throw new Error("draft-response output must be an object");
    }
    const body = (draft as { body?: string }).body;
    if (!isNonEmptyString(body)) {
      throw new Error("draft-response output must include non-empty body");
    }

    return {
      repo: assessment.fields.repo,
      issueNumber: assessment.fields.issueNumber,
      isPullRequest: assessment.fields.isPullRequest,
      originalCommentId: assessment.fields.commentId,
      mode: "agent",
      body: boundedBody(body),
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
      event: "github.issue_comment.mention",
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
