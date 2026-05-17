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

module.exports = [
  {
    name: "github_get_pr",
    description: "Fixture-local read-only GitHub PR lookup.",
    risk: "safe",
    kind: "discovery",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string" },
        number: { type: "number" },
      },
      required: ["number"],
    },
    run(input) {
      logToolCall("github_get_pr", input);
      return "Fixture PR details for replay.";
    },
  },
  {
    name: "github_list_prs",
    description: "Fixture-local read-only GitHub PR list.",
    risk: "safe",
    kind: "discovery",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string" },
        state: { type: "string" },
        head: { type: "string" },
      },
      required: [],
    },
    run(input) {
      logToolCall("github_list_prs", input);
      return "Fixture PR list for replay.";
    },
  },
  {
    name: "github_comment",
    description: "Fixture-local GitHub comment recorder.",
    risk: "dangerous",
    kind: "action",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string" },
        number: { type: "number" },
        body: { type: "string" },
      },
      required: ["number", "body"],
    },
    run(input) {
      logToolCall("github_comment", input);
      return "Comment posted (ID: 4242)\nhttps://github.com/kota-test/example/issues/42#issuecomment-4242";
    },
  },
];
