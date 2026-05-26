import { defineDaemonWideModuleEvent } from "#core/events/module-event.js";

export type RepoAiChecksCompletedPayload = {
  repo: string;
  prNumber: number;
  total: number;
  pass: number;
  fail: number;
  skip: number;
  artifactDir: string;
};

// GitHub pull-request webhook payloads are daemon-wide today. This event should
// become project-scoped when GitHub webhook delivery carries project identity.
export const repoAiChecksCompletedEvent =
  defineDaemonWideModuleEvent<RepoAiChecksCompletedPayload>(
    "repo-ai-checks.completed",
    ["repo", "prNumber", "total", "pass", "fail", "skip", "artifactDir"],
  );
