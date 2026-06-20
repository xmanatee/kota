import { existsSync, mkdirSync } from "node:fs";
import { writeJsonFileAtomic } from "#core/util/json-file.js";

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function safeJsonStringify(value: unknown, indent?: number): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_, current) => {
      if (typeof current === "bigint") return current.toString();
      if (typeof current === "function") {
        return `[Function ${current.name || "anonymous"}]`;
      }
      if (current instanceof Error) {
        return {
          name: current.name,
          message: current.message,
          stack: current.stack,
        };
      }
      if (current instanceof Map) {
        return Object.fromEntries(current);
      }
      if (current instanceof Set) {
        return Array.from(current);
      }
      if (current && typeof current === "object") {
        if (seen.has(current)) return "[Circular]";
        seen.add(current);
      }
      return current;
    },
    indent,
  );
}

export function writeJsonFile(path: string, value: unknown): void {
  writeJsonFileAtomic(path, value, (current) => safeJsonStringify(current, 2));
}

/**
 * Strict JSON writer for internal protocol state that must round-trip as
 * plain typed data. Uses native JSON.stringify, which throws TypeError on
 * cycles — unlike {@link safeJsonStringify} which silently emits a
 * "[Circular]" string. Callers persisting internal protocol data (queue
 * state, trigger payloads) should use this so a cycle fails loudly at
 * persist time instead of silently corrupting a downstream reader.
 */
export function writeStrictJsonFile(path: string, value: unknown): void {
  writeJsonFileAtomic(path, value);
}

const PATH_SAFE_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateWorkflowRunId(runId: string, source: string): string {
  const trimmed = runId.trim();
  if (trimmed.length === 0) {
    throw new Error(`${source} run id must be non-empty`);
  }
  if (trimmed !== runId) {
    throw new Error(`${source} run id must not contain leading or trailing whitespace`);
  }
  if (
    trimmed === "." ||
    trimmed === ".." ||
    !PATH_SAFE_RUN_ID_PATTERN.test(trimmed)
  ) {
    throw new Error(
      `${source} run id "${runId}" must be a path-safe segment containing only letters, numbers, ".", "_", or "-"`,
    );
  }
  return trimmed;
}

export function workflowRunIdFromPayload(
  runId: string | undefined,
  source: string,
): string | undefined {
  if (runId === undefined) return undefined;
  return validateWorkflowRunId(runId, `${source} payload _runId`);
}

function workflowNameRunIdSegment(workflowName: string): string {
  return workflowName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workflow";
}

export function formatRunId(workflowName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return validateWorkflowRunId(
    `${stamp}-${workflowNameRunIdSegment(workflowName)}-${suffix}`,
    `Generated workflow "${workflowName}"`,
  );
}
