import {
  type InboundSignalActorTrust,
  type InboundSignalJsonObject,
  type InboundSignalJsonValue,
  type InboundSignalReceivedPayload,
  type InboundSignalValidationResult,
  validateInboundSignalPayload,
} from "#modules/inbound-signals/events.js";
import type { GitHubIssueCommentMentionEventPayload } from "./events.js";

export type GitHubIssueCommentInboundSignalContext = {
  projectId: string;
  occurredAt: string;
  receivedAt: string;
};

function trustFromGitHubIntegrity(
  integrity: GitHubIssueCommentMentionEventPayload["actorIntegrity"],
): InboundSignalActorTrust {
  if (integrity === "allowed") return "trusted";
  if (integrity === "blocked_actor") return "blocked";
  return "untrusted";
}

function sourceId(payload: GitHubIssueCommentMentionEventPayload): string {
  if (
    payload.repo === null ||
    payload.issueNumber === null ||
    payload.commentId === null
  ) {
    return "";
  }
  return `github:${payload.repo}:issue:${payload.issueNumber}:comment:${payload.commentId}`;
}

function externalId(payload: GitHubIssueCommentMentionEventPayload): string {
  if (payload.repositoryId === null || payload.commentId === null) return "";
  return `github:${payload.repositoryId}:issue_comment:${payload.commentId}`;
}

function actorIdentity(payload: GitHubIssueCommentMentionEventPayload): {
  id: string;
  displayName: string;
} {
  const login = payload.commenter.login ?? payload.sender.login;
  if (login !== null) {
    return { id: `github:${login}`, displayName: login };
  }
  const commentId = payload.commentId === null ? "missing" : String(payload.commentId);
  return {
    id: `github:unidentified-commenter:${commentId}`,
    displayName: "unidentified GitHub commenter",
  };
}

export function githubIssueCommentMentionToInboundSignal(
  payload: GitHubIssueCommentMentionEventPayload,
  context: GitHubIssueCommentInboundSignalContext,
): InboundSignalValidationResult {
  const actor = actorIdentity(payload);
  return validateInboundSignalPayload({
    scopeId: context.projectId,
    projectId: context.projectId,
    provider: "github",
    channel: "github.issue_comment",
    accountId: payload.repo === null ? "" : `github:${payload.repo}`,
    sourceId: sourceId(payload),
    sourceUrl: payload.commentUrl ?? "",
    externalId: externalId(payload),
    occurredAt: context.occurredAt,
    receivedAt: context.receivedAt,
    actor: {
      id: actor.id,
      displayName: actor.displayName,
      trust: trustFromGitHubIntegrity(payload.actorIntegrity),
      trustReason: payload.actorIntegrityReason,
    },
    body: {
      kind: "action",
      action: "github.issue_comment.mention",
      label:
        payload.repo === null || payload.issueNumber === null
          ? "GitHub issue comment mention"
          : `GitHub issue comment mention on ${payload.repo}#${payload.issueNumber}`,
      data: {
        repo: payload.repo,
        repositoryId: payload.repositoryId,
        repositoryUrl: payload.repositoryUrl,
        action: payload.action,
        issueNumber: payload.issueNumber,
        issueTitle: payload.issueTitle,
        issueUrl: payload.issueUrl,
        isPullRequest: payload.isPullRequest,
        commentId: payload.commentId,
        commentBody: payload.commentBody,
        commentUrl: payload.commentUrl,
        commenter: {
          login: payload.commenter.login,
          type: payload.commenter.type,
        },
        sender: {
          login: payload.sender.login,
          type: payload.sender.type,
        },
        authorAssociation: payload.authorAssociation,
        matchedMentionAlias: payload.matchedMentionAlias,
        actorIntegrity: payload.actorIntegrity,
        actorIntegrityReason: payload.actorIntegrityReason,
        reason: payload.reason,
      },
    },
  });
}

function signalObject(
  value: InboundSignalJsonValue | undefined,
): InboundSignalJsonObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as InboundSignalJsonObject;
}

function signalString(value: InboundSignalJsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function signalNumber(value: InboundSignalJsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function signalBoolean(value: InboundSignalJsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function signalActor(
  value: InboundSignalJsonValue | undefined,
): GitHubIssueCommentMentionEventPayload["commenter"] | undefined {
  const actor = signalObject(value);
  if (!actor) return undefined;
  return {
    login: signalString(actor.login),
    type: signalString(actor.type),
  };
}

export function githubIssueCommentMentionFromInboundSignal(
  payload: InboundSignalReceivedPayload,
): Partial<GitHubIssueCommentMentionEventPayload> {
  if (payload.provider !== "github") return {};
  if (payload.channel !== "github.issue_comment") return {};
  if (payload.body.kind !== "action") return {};
  if (payload.body.action !== "github.issue_comment.mention") return {};

  const data = payload.body.data;
  const actorIntegrity = signalString(data.actorIntegrity);
  return {
    repo: signalString(data.repo),
    repositoryId: signalNumber(data.repositoryId),
    repositoryUrl: signalString(data.repositoryUrl),
    action: signalString(data.action),
    issueNumber: signalNumber(data.issueNumber),
    issueTitle: signalString(data.issueTitle),
    issueUrl: signalString(data.issueUrl),
    isPullRequest: signalBoolean(data.isPullRequest) ?? false,
    commentId: signalNumber(data.commentId),
    commentBody: signalString(data.commentBody),
    commentUrl: signalString(data.commentUrl),
    commenter: signalActor(data.commenter),
    sender: signalActor(data.sender),
    authorAssociation: signalString(data.authorAssociation),
    matchedMentionAlias: signalString(data.matchedMentionAlias),
    actorIntegrity:
      actorIntegrity === "allowed" ||
      actorIntegrity === "blocked_actor" ||
      actorIntegrity === "low_trust_actor" ||
      actorIntegrity === "missing_metadata"
        ? actorIntegrity
        : undefined,
    actorIntegrityReason: signalString(data.actorIntegrityReason) ?? undefined,
    reason: signalString(data.reason) ?? undefined,
  };
}
