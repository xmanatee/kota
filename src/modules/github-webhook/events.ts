import { defineDaemonWideModuleEvent } from "#core/events/module-event.js";

export type GitHubWebhookActor = {
  login: string | null;
  type: string | null;
};

export type GitHubWebhookActorIntegrity =
  | "allowed"
  | "blocked_actor"
  | "low_trust_actor"
  | "missing_metadata";

export type GitHubPullRequestEventPayload = {
  repo: string | null;
  action: string | null;
  number: number | null;
  title: string | null;
  state: string | null;
  merged: boolean | null;
  headBranch: string | null;
  baseBranch: string | null;
  headRepo: string | null;
  isFork: boolean | null;
  headSha: string | null;
  sender: GitHubWebhookActor;
  prAuthor: GitHubWebhookActor;
  authorAssociation: string | null;
  actorIntegrity: GitHubWebhookActorIntegrity;
  actorIntegrityReason: string;
};

export type GitHubIssueCommentMentionEventPayload = {
  repo: string | null;
  repositoryId: number | null;
  repositoryUrl: string | null;
  action: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  issueUrl: string | null;
  isPullRequest: boolean;
  commentId: number | null;
  commentBody: string | null;
  commentUrl: string | null;
  commenter: GitHubWebhookActor;
  sender: GitHubWebhookActor;
  authorAssociation: string | null;
  matchedMentionAlias: string | null;
  actorIntegrity: GitHubWebhookActorIntegrity;
  actorIntegrityReason: string;
  reason: string;
};

// GitHub webhook routes do not carry project attribution today; this should
// migrate to project scope when inbound webhook routes are project-addressed.
export const githubPullRequestEvent =
  defineDaemonWideModuleEvent<GitHubPullRequestEventPayload>(
    "github.pull_request",
    [
      "repo",
      "action",
      "number",
      "title",
      "state",
      "merged",
      "headBranch",
      "baseBranch",
      "headRepo",
      "isFork",
      "headSha",
      "sender",
      "prAuthor",
      "authorAssociation",
      "actorIntegrity",
      "actorIntegrityReason",
    ],
  );
