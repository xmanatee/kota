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
    {
      payloadSchema: {
        type: "object",
        properties: {
          repo: { type: "string" },
          prNumber: { type: "number" },
          total: { type: "number" },
          pass: { type: "number" },
          fail: { type: "number" },
          skip: { type: "number" },
          artifactDir: { type: "string" },
        },
      },
      sensitivity: "internal",
    },
  );
