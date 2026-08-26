import { resolve } from "node:path";
import type { ToolRunnerContext } from "#core/tools/index.js";

export type BrowserSessionIdentity = {
  scopeId: string;
  sessionId: string;
  scopeRoot: string;
};

export function resolveBrowserSessionIdentity(
  context: ToolRunnerContext | undefined,
): BrowserSessionIdentity {
  const sessionId = context?.sessionId;
  if (!sessionId) {
    throw new Error("Browser tools require an active session identity");
  }

  const scopeValues = [
    context.scopeId,
    context.scopeId,
    context.workflow?.scopeId,
    context.workflow?.scopeId,
  ].filter((value): value is string => value !== undefined);
  if (scopeValues.some((value) => value.length === 0)) {
    throw new Error("Browser tools require a non-empty scope identity");
  }
  if (scopeValues.length === 0) {
    throw new Error("Browser tools require an active scope");
  }
  if (new Set(scopeValues).size !== 1) {
    throw new Error("Browser tool scope identity values conflict");
  }
  if (!context.scopeRoot) {
    throw new Error("Browser tools require the invoking scope root");
  }
  return {
    sessionId,
    scopeId: scopeValues[0]!,
    scopeRoot: resolve(context.scopeRoot),
  };
}
