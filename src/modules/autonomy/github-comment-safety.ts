export type OutboundGitHubCommentSecretClass =
  | "github-token"
  | "anthropic-api-key"
  | "openai-api-key"
  | "aws-access-key"
  | "private-key-block"
  | "bearer-token"
  | "api-key-assignment";

export type OutboundGitHubCommentSecretScanResult =
  | { status: "clean" }
  | { status: "suspect"; secretClass: OutboundGitHubCommentSecretClass };

type SecretPattern = {
  secretClass: OutboundGitHubCommentSecretClass;
  pattern: RegExp;
};

const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    secretClass: "private-key-block",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/i,
  },
  {
    secretClass: "github-token",
    pattern: /\b(?:gh[oprsu]_[A-Za-z0-9_]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/,
  },
  {
    secretClass: "anthropic-api-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/,
  },
  {
    secretClass: "openai-api-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  },
  {
    secretClass: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    secretClass: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{32,}\b/i,
  },
  {
    secretClass: "api-key-assignment",
    pattern:
      /\b(?:api[_-]?key|x-api-key|access[_-]?token|client[_-]?secret|secret[_-]?key|auth[_-]?token|token)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{32,}["']?/i,
  },
];

export function validateOutboundGitHubCommentBody(
  body: string,
): OutboundGitHubCommentSecretScanResult {
  for (const { secretClass, pattern } of SECRET_PATTERNS) {
    if (pattern.test(body)) {
      return { status: "suspect", secretClass };
    }
  }
  return { status: "clean" };
}

export function assertOutboundGitHubCommentBodyIsSafe(body: string): void {
  const result = validateOutboundGitHubCommentBody(body);
  if (result.status === "clean") return;
  throw new Error(
    `outbound GitHub comment body contains suspected secret pattern: ${result.secretClass}`,
  );
}
