const fs = require("node:fs");
const path = require("node:path");

function logToolCall(tool, input) {
  const dir = path.join(process.cwd(), ".kota", "external-calls");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, `${tool}.jsonl`),
    `${JSON.stringify({
      tool,
      input,
      exitCode: 0,
      timestamp: new Date().toISOString(),
    })}\n`,
  );
}

const readGitHubEffect = {
  kind: "read",
  scope: "external-network",
  idempotent: false,
  openWorld: true,
};

const writeGitHubEffect = {
  kind: "destructive",
  scope: "external-network",
  idempotent: false,
  openWorld: true,
};

module.exports = {
  name: "github-comment-fixture",
  version: "1.0.0",
  description: "Fixture-local GitHub tools for pr-reviewer replay.",
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "github-comment-fixture.github",
        description: "Replay-only GitHub PR inspection and comment recording.",
        scope: "external",
        scopePolicyHooks: ["external-effects", "owner-confirmation"],
      },
    ],
    dataClasses: [
      {
        id: "github-comment-fixture.payloads",
        description: "Fixture-local GitHub tool call payloads recorded under .kota/external-calls.",
        sensitivity: "provider-payload",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Fixture GitHub comment recording represents an external write path and is blocked outside replay isolation.",
      ],
    },
  },
  tools: [
    {
      effect: readGitHubEffect,
      tool: {
        name: "github_get_pr",
        description: "Fixture-local read-only GitHub PR lookup.",
        input_schema: {
          type: "object",
          properties: {
            repo: { type: "string" },
            number: { type: "number" },
          },
          required: ["number"],
        },
      },
      async runner(input) {
        logToolCall("github_get_pr", input);
        return { content: "Fixture PR details for replay." };
      },
    },
    {
      effect: readGitHubEffect,
      tool: {
        name: "github_list_prs",
        description: "Fixture-local read-only GitHub PR list.",
        input_schema: {
          type: "object",
          properties: {
            repo: { type: "string" },
            state: { type: "string" },
            head: { type: "string" },
          },
          required: [],
        },
      },
      async runner(input) {
        logToolCall("github_list_prs", input);
        return { content: "Fixture PR list for replay." };
      },
    },
    {
      effect: writeGitHubEffect,
      tool: {
        name: "github_comment",
        description: "Fixture-local GitHub comment recorder.",
        input_schema: {
          type: "object",
          properties: {
            repo: { type: "string" },
            number: { type: "number" },
            body: { type: "string" },
          },
          required: ["number", "body"],
        },
      },
      async runner(input) {
        logToolCall("github_comment", input);
        return {
          content:
            "Comment posted (ID: 4242)\nhttps://github.com/kota-test/example/issues/42#issuecomment-4242",
        };
      },
    },
  ],
};
