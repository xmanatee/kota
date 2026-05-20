import { describe, expect, it } from "vitest";
import {
  assertOutboundGitHubCommentBodyIsSafe,
  type OutboundGitHubCommentSecretClass,
  validateOutboundGitHubCommentBody,
} from "./github-comment-safety.js";

function githubToken(): string {
  return `${"ghp"}_${"A".repeat(36)}`;
}

function openAiKey(): string {
  return `${"sk"}-${"a1".repeat(24)}`;
}

function anthropicKey(): string {
  return `${"sk-ant"}-${"b2".repeat(24)}`;
}

function awsAccessKey(): string {
  return `${"AKIA"}${"A1".repeat(8)}`;
}

function bearerToken(): string {
  return `${"c3".repeat(20)}.${"d4".repeat(20)}`;
}

function assignedApiKey(): string {
  return `${"e5".repeat(24)}`;
}

const suspectCases: Array<[OutboundGitHubCommentSecretClass, string]> = [
  ["github-token", githubToken()],
  ["openai-api-key", openAiKey()],
  ["anthropic-api-key", anthropicKey()],
  ["aws-access-key", awsAccessKey()],
  [
    "private-key-block",
    ["-----BEGIN PRIVATE KEY-----", "fake-private-material", "-----END PRIVATE KEY-----"].join("\n"),
  ],
  ["bearer-token", `Authorization: Bearer ${bearerToken()}`],
  ["api-key-assignment", `api_key = "${assignedApiKey()}"`],
];

describe("outbound GitHub comment safety", () => {
  it("keeps normal workflow comment bodies clean", () => {
    const body = [
      "Thanks for the implementation mention on issue #17.",
      "",
      "Created KOTA task `task-block-high-confidence-secret-patterns-in-github-wor` in `data/tasks/ready/task-block-high-confidence-secret-patterns-in-github-wor.md`.",
      "Reference: https://github.com/owner/repo/issues/17#issuecomment-1234",
      "This can mention secret or token as prose without a credential value.",
    ].join("\n");

    expect(validateOutboundGitHubCommentBody(body)).toEqual({ status: "clean" });
    expect(() => assertOutboundGitHubCommentBodyIsSafe(body)).not.toThrow();
  });

  it.each(suspectCases)("flags %s without returning the matched value", (secretClass, body) => {
    const result = validateOutboundGitHubCommentBody(body);

    expect(result).toEqual({ status: "suspect", secretClass });
    expect(JSON.stringify(result)).not.toContain(body);
  });

  it("throws a diagnostic that names only the secret class", () => {
    const token = githubToken();

    expect(() => assertOutboundGitHubCommentBodyIsSafe(`token: ${token}`)).toThrow(
      /github-token/,
    );

    try {
      assertOutboundGitHubCommentBodyIsSafe(`token: ${token}`);
      throw new Error("expected helper to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("github-token");
      expect(message).not.toContain(token);
    }
  });
});
