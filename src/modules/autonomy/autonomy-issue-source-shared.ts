import { createHash } from "node:crypto";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  autonomyHealthSignal,
  normalizeHealthSignal,
} from "./health-signal.js";

export function workflowFailureHealthSource(workflowName: string) {
  return {
    kind: "workflow",
    id: workflowName,
    workflow: workflowName,
  } as const;
}

export function stableToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

export function stableIssueHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function normalizedWorkflowFailure(error: string): string {
  return error
    .toLowerCase()
    .replace(/[0-9a-f]{7,64}/g, "<hash>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

export function workflowFailureIssueKey(args: {
  workflowName: string;
  errorSummary: string;
  fallback: string;
}): string {
  const normalized = normalizedWorkflowFailure(args.errorSummary);
  const failureKey = normalized.length > 0
    ? stableIssueHash(normalized)
    : stableToken(args.fallback);
  return `workflow:${stableToken(args.workflowName)}:failure:${failureKey}`;
}

export function emitHealth(
  ctx: Pick<ModuleRuntimeContext, "events">,
  scopeId: string,
  input: Parameters<typeof normalizeHealthSignal>[0],
): void {
  const signal = normalizeHealthSignal(input);
  ctx.events.emit(autonomyHealthSignal, {
    scopeId,
    ...signal,
  });
}
