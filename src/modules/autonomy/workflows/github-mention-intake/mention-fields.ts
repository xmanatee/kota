import type {
  GitHubIssueCommentMentionEventPayload,
  GitHubWebhookActor,
} from "#modules/github-webhook/events.js";
import { githubIssueCommentMentionFromInboundSignal } from "#modules/github-webhook/inbound-signal.js";
import {
  type InboundSignalReceivedPayload,
  inboundSignalReceived,
} from "#modules/inbound-signals/events.js";

type MentionWebhookPayload = Partial<GitHubIssueCommentMentionEventPayload>;

export type NormalizedMentionFields = {
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

export function isNonEmptyString(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function mentionPayloadFromTrigger(trigger: {
  event: string;
  payload: object;
}): MentionWebhookPayload {
  const signal = signalPayloadFromTrigger(trigger);
  return signal ? githubIssueCommentMentionFromInboundSignal(signal) : {};
}

function signalPayloadFromTrigger(trigger: {
  event: string;
  payload: object;
}): InboundSignalReceivedPayload | null {
  const payload = trigger.payload as Partial<
    InboundSignalReceivedPayload & { signal: InboundSignalReceivedPayload }
  >;
  if (payload.signal && typeof payload.signal === "object") {
    return payload.signal;
  }
  if (trigger.event !== inboundSignalReceived.name) return null;
  return payload as InboundSignalReceivedPayload;
}

function hasCompleteActor(
  actor: GitHubWebhookActor | undefined,
): actor is { login: string; type: string } {
  return isNonEmptyString(actor?.login) && isNonEmptyString(actor?.type);
}

export function assessActorIntegrity(
  payload: MentionWebhookPayload,
): string | null {
  if (payload.actorIntegrity === "allowed") return null;
  if (payload.actorIntegrity === "blocked_actor") {
    return `blocked actor: ${payload.actorIntegrityReason ?? "webhook payload marked the actor as blocked"}`;
  }
  if (payload.actorIntegrity === "low_trust_actor") {
    return `low-trust actor: ${payload.actorIntegrityReason ?? "webhook payload did not meet the trust threshold"}`;
  }
  if (payload.actorIntegrity === "missing_metadata") {
    return `missing actor trust metadata: ${payload.actorIntegrityReason ?? "webhook payload omitted actor integrity fields"}`;
  }
  return "missing actor trust metadata: webhook payload omitted actorIntegrity";
}

export function normalizedFields(
  payload: MentionWebhookPayload,
): NormalizedMentionFields | { skipReason: string } {
  if (!isNonEmptyString(payload.repo)) {
    return { skipReason: "malformed mention payload: missing repo" };
  }
  if (typeof payload.issueNumber !== "number") {
    return { skipReason: "malformed mention payload: missing issue number" };
  }
  if (!isNonEmptyString(payload.issueTitle)) {
    return { skipReason: "malformed mention payload: missing issue title" };
  }
  if (!isNonEmptyString(payload.issueUrl)) {
    return { skipReason: "malformed mention payload: missing issue URL" };
  }
  if (typeof payload.isPullRequest !== "boolean") {
    return { skipReason: "malformed mention payload: missing issue/PR kind" };
  }
  if (typeof payload.commentId !== "number") {
    return { skipReason: "malformed mention payload: missing comment id" };
  }
  if (!isNonEmptyString(payload.commentBody)) {
    return { skipReason: "malformed mention payload: missing comment body" };
  }
  if (!isNonEmptyString(payload.commentUrl)) {
    return { skipReason: "malformed mention payload: missing comment URL" };
  }
  if (!hasCompleteActor(payload.commenter)) {
    return { skipReason: "malformed mention payload: missing commenter metadata" };
  }
  if (!hasCompleteActor(payload.sender)) {
    return { skipReason: "malformed mention payload: missing sender metadata" };
  }
  if (!isNonEmptyString(payload.authorAssociation)) {
    return { skipReason: "malformed mention payload: missing author association" };
  }
  if (!isNonEmptyString(payload.matchedMentionAlias)) {
    return { skipReason: "malformed mention payload: missing matched mention alias" };
  }
  if (!isNonEmptyString(payload.actorIntegrityReason)) {
    return { skipReason: "malformed mention payload: missing actor integrity reason" };
  }
  return {
    repo: payload.repo,
    issueNumber: payload.issueNumber,
    issueTitle: payload.issueTitle,
    issueUrl: payload.issueUrl,
    isPullRequest: payload.isPullRequest,
    commentId: payload.commentId,
    commentBody: payload.commentBody,
    commentUrl: payload.commentUrl,
    commenter: payload.commenter,
    sender: payload.sender,
    authorAssociation: payload.authorAssociation,
    matchedMentionAlias: payload.matchedMentionAlias,
    actorIntegrityReason: payload.actorIntegrityReason,
  };
}

export function validateNormalizedMentionFields(
  fields: NormalizedMentionFields | undefined,
): NormalizedMentionFields {
  if (!fields) throw new Error("mention intake assessment missing normalized fields");
  const normalized = normalizedFields({ ...fields, actorIntegrity: "allowed" });
  if ("skipReason" in normalized) throw new Error(normalized.skipReason);
  return fields;
}

export function surfaceLabel(fields: NormalizedMentionFields): string {
  return fields.isPullRequest
    ? `PR #${fields.issueNumber}`
    : `issue #${fields.issueNumber}`;
}
