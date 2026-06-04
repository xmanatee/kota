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

const githubActorSchema = {
  type: "object" as const,
  properties: {
    login: { type: "string" as const, nullable: true },
    type: { type: "string" as const, nullable: true },
  },
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
    {
      payloadSchema: {
        type: "object",
        properties: {
          repo: { type: "string", nullable: true },
          action: { type: "string", nullable: true },
          number: { type: "number", nullable: true },
          title: { type: "string", nullable: true },
          state: { type: "string", nullable: true },
          merged: { type: "boolean", nullable: true },
          headBranch: { type: "string", nullable: true },
          baseBranch: { type: "string", nullable: true },
          headRepo: { type: "string", nullable: true },
          isFork: { type: "boolean", nullable: true },
          headSha: { type: "string", nullable: true },
          sender: githubActorSchema,
          prAuthor: githubActorSchema,
          authorAssociation: { type: "string", nullable: true },
          actorIntegrity: {
            type: "string",
            enum: [
              "allowed",
              "blocked_actor",
              "low_trust_actor",
              "missing_metadata",
            ],
          },
          actorIntegrityReason: { type: "string" },
        },
      },
      sensitivity: "internal",
    },
  );
