import { expectStructuredOutput } from "#core/workflow/step-input-code.js";
import { assertOutboundGitHubCommentBodyIsSafe } from "#modules/autonomy/github-comment-safety.js";
import type {
  GitHubIssueCommentMentionEventPayload,
  GitHubWebhookActor,
} from "#modules/github-webhook/events.js";
import { githubIssueCommentMentionFromInboundSignal } from "#modules/github-webhook/inbound-signal.js";
import {
  type InboundSignalReceivedPayload,
  inboundSignalReceived,
} from "#modules/inbound-signals/events.js";

const MAX_COMMENT_BODY_CHARS = 4_000;
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
    }
  | {
      decision: "prepared";
      agentEligible: false;
      commentEligible: true;
      comment: PreparedGithubMentionComment;
    };

export type PreparedGithubMentionComment = {
  repo: string;
  issueNumber: number;
  isPullRequest: boolean;
  originalCommentId: number;
  mode: "agent" | "created" | "existing" | "needs_detail";
  body: string;
};

export const GITHUB_MENTION_INTAKE_COMMENT_REQUESTED_EVENT =
  "github-mention-intake.comment.requested";

export type GithubMentionResponseDraft = { body: string };

export function isNonEmptyString(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function mentionPayloadFromTrigger(
  trigger: { event: string; payload: object },
): MentionWebhookPayload {
  const signal = signalPayloadFromTrigger(trigger);
  return signal ? githubIssueCommentMentionFromInboundSignal(signal) : {};
}

function signalPayloadFromTrigger(
  trigger: { event: string; payload: object },
): InboundSignalReceivedPayload | null {
  const payload = trigger.payload as Partial<
    InboundSignalReceivedPayload & { signal: InboundSignalReceivedPayload }
  >;
  if (payload.signal && typeof payload.signal === "object") return payload.signal;
  if (trigger.event !== inboundSignalReceived.name) return null;
  return payload as InboundSignalReceivedPayload;
}

function hasCompleteActor(
  actor: GitHubWebhookActor | undefined,
): actor is { login: string; type: string } {
  return isNonEmptyString(actor?.login) && isNonEmptyString(actor?.type);
}

export function skip(skipReason: string): GithubMentionAssessment {
  return {
    decision: "skip",
    agentEligible: false,
    commentEligible: false,
    skipReason,
  };
}

export function assessActorIntegrity(p: MentionWebhookPayload): string | null {
  if (p.actorIntegrity === "allowed") return null;
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

export function normalizedFields(
  p: MentionWebhookPayload,
): NormalizedMentionFields | { skipReason: string } {
  if (!isNonEmptyString(p.repo)) return { skipReason: "malformed mention payload: missing repo" };
  if (typeof p.issueNumber !== "number") return { skipReason: "malformed mention payload: missing issue number" };
  if (!isNonEmptyString(p.issueTitle)) return { skipReason: "malformed mention payload: missing issue title" };
  if (!isNonEmptyString(p.issueUrl)) return { skipReason: "malformed mention payload: missing issue URL" };
  if (typeof p.isPullRequest !== "boolean") return { skipReason: "malformed mention payload: missing issue/PR kind" };
  if (typeof p.commentId !== "number") return { skipReason: "malformed mention payload: missing comment id" };
  if (!isNonEmptyString(p.commentBody)) return { skipReason: "malformed mention payload: missing comment body" };
  if (!isNonEmptyString(p.commentUrl)) return { skipReason: "malformed mention payload: missing comment URL" };
  if (!hasCompleteActor(p.commenter)) return { skipReason: "malformed mention payload: missing commenter metadata" };
  if (!hasCompleteActor(p.sender)) return { skipReason: "malformed mention payload: missing sender metadata" };
  if (!isNonEmptyString(p.authorAssociation)) return { skipReason: "malformed mention payload: missing author association" };
  if (!isNonEmptyString(p.matchedMentionAlias)) return { skipReason: "malformed mention payload: missing matched mention alias" };
  if (!isNonEmptyString(p.actorIntegrityReason)) return { skipReason: "malformed mention payload: missing actor integrity reason" };
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

function validateNormalizedMentionFields(
  fields: NormalizedMentionFields | undefined,
): NormalizedMentionFields {
  if (!fields) throw new Error("mention assessment missing normalized fields");
  if (!isNonEmptyString(fields.repo)) throw new Error("mention assessment fields missing repo");
  if (typeof fields.issueNumber !== "number") throw new Error("mention assessment fields missing issue number");
  if (!isNonEmptyString(fields.issueTitle)) throw new Error("mention assessment fields missing issue title");
  if (!isNonEmptyString(fields.issueUrl)) throw new Error("mention assessment fields missing issue URL");
  if (typeof fields.isPullRequest !== "boolean") throw new Error("mention assessment fields missing issue/PR kind");
  if (typeof fields.commentId !== "number") throw new Error("mention assessment fields missing comment id");
  if (!isNonEmptyString(fields.commentBody)) throw new Error("mention assessment fields missing comment body");
  if (!isNonEmptyString(fields.commentUrl)) throw new Error("mention assessment fields missing comment URL");
  if (!hasCompleteActor(fields.commenter)) throw new Error("mention assessment fields missing commenter");
  if (!hasCompleteActor(fields.sender)) throw new Error("mention assessment fields missing sender");
  if (!isNonEmptyString(fields.authorAssociation)) throw new Error("mention assessment fields missing author association");
  if (!isNonEmptyString(fields.matchedMentionAlias)) throw new Error("mention assessment fields missing matched mention alias");
  if (!isNonEmptyString(fields.actorIntegrityReason)) throw new Error("mention assessment fields missing actor integrity reason");
  return fields;
}

export function validateAssessment(
  raw: Parameters<typeof expectStructuredOutput<GithubMentionAssessment>>[0],
): GithubMentionAssessment {
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
  if (obj.decision === "prepared") {
    if (assessment.agentEligible !== false || assessment.commentEligible !== true) {
      throw new Error("prepared assessment must disable the agent and enable comments");
    }
    validatePreparedComment(assessment.comment);
    return assessment;
  }
  throw new Error(`unexpected mention assessment decision: ${obj.decision}`);
}

export function validatePreparedComment(
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
  if (
    obj.mode !== "agent" &&
    obj.mode !== "created" &&
    obj.mode !== "existing" &&
    obj.mode !== "needs_detail"
  ) throw new Error(`prepared comment mode is invalid: ${obj.mode}`);
  if (!isNonEmptyString(obj.body)) throw new Error("prepared comment missing body");
  assertOutboundGitHubCommentBodyIsSafe(obj.body);
  return raw as PreparedGithubMentionComment;
}

export function validateResponseDraft(
  raw: Parameters<typeof expectStructuredOutput<GithubMentionResponseDraft>>[0],
): GithubMentionResponseDraft {
  const obj = expectStructuredOutput<GithubMentionResponseDraft>(raw, ["body"]);
  if (!isNonEmptyString(obj.body)) throw new Error("draft-response output must include non-empty body");
  assertOutboundGitHubCommentBodyIsSafe(obj.body);
  return { body: obj.body };
}

export function boundedBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length <= MAX_COMMENT_BODY_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_COMMENT_BODY_CHARS - 28).trimEnd()}\n\n[Response truncated]`;
}
