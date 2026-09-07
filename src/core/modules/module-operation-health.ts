import { createHash } from "node:crypto";

export type ModuleOperationFailureKind =
  | "duplicate-consumer"
  | "auth"
  | "provider"
  | "cost-risk"
  | "local-code"
  | "unknown";

export type ModuleOperationFailureIdentity = {
  failureKind: ModuleOperationFailureKind;
  causeKey: string;
};

function stableToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function normalizedFailure(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{7,64}/g, "<hash>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

function failureHash(message: string): string {
  return createHash("sha256")
    .update(normalizedFailure(message))
    .digest("hex")
    .slice(0, 16);
}

export function classifyModuleOperationFailure(args: {
  module: string;
  operation: string;
  message: string;
}): ModuleOperationFailureIdentity {
  const normalized = normalizedFailure(args.message);
  const operation = stableToken(args.operation);
  if (
    stableToken(args.module) === "telegram" &&
    /getupdates/.test(normalized) &&
    /(conflict|terminated by other getupdates request|409)/.test(normalized)
  ) {
    return {
      failureKind: "duplicate-consumer",
      causeKey: "getupdates-conflict",
    };
  }
  if (/(unauthorized|forbidden|invalid token|auth|oauth|401|403)/.test(normalized)) {
    return { failureKind: "auth", causeKey: "auth-failure" };
  }
  if (
    /(rate limit|429|timeout|econnreset|etimedout|enotfound|network|temporar)/.test(
      normalized,
    )
  ) {
    return { failureKind: "provider", causeKey: "external-provider-failure" };
  }
  if (/(cost|budget|spend|token).*(exceed|limit|spike|risk|runaway)/.test(normalized)) {
    return { failureKind: "cost-risk", causeKey: "cost-risk" };
  }
  const hash = failureHash(normalized);
  if (
    /(typeerror|referenceerror|syntaxerror|err_module_not_found|cannot find module|invariant|assertion failed)/.test(
      normalized,
    )
  ) {
    return {
      failureKind: "local-code",
      causeKey: `${operation}:local-code:${hash}`,
    };
  }
  return {
    failureKind: "unknown",
    causeKey: `${operation}:unknown:${hash}`,
  };
}
