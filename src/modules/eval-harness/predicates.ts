/**
 * Pass/fail predicates for autonomy eval-harness fixtures.
 *
 * Predicates inspect actual repo state (file contents, shell exit codes) after
 * a fixture run, not the agent's self-report. The DSL is deliberately small
 * and boringly deterministic: the harness is a measurement device, not a
 * second test framework. If a fixture needs richer verification, add a new
 * predicate kind here rather than pushing logic into the fixture author.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type FixturePredicate =
  | { kind: "file-exists"; path: string }
  | { kind: "file-absent"; path: string }
  | { kind: "file-contains"; path: string; needle: string }
  | {
      kind: "shell-succeeds";
      command: string;
      /** Per-command timeout in ms. Capped at 5 minutes. */
      timeoutMs?: number;
    }
  | {
      kind: "shell-fails";
      command: string;
      timeoutMs?: number;
    };

export type PredicateEvalResult = {
  predicate: FixturePredicate;
  passed: boolean;
  /** Short explanation — always present, for artifact readability. */
  detail: string;
};

const SHELL_PREDICATE_MAX_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SHELL_TIMEOUT_MS = 60_000;
const OUTPUT_TAIL_LIMIT = 4_000;

function tail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `[... ${text.length - limit} chars truncated ...]\n${text.slice(-limit)}`;
}

function resolvedShellTimeout(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_SHELL_TIMEOUT_MS;
  if (requested <= 0) {
    throw new Error(`Shell predicate timeoutMs must be positive, got ${requested}.`);
  }
  return Math.min(requested, SHELL_PREDICATE_MAX_TIMEOUT_MS);
}

function evaluateFileExists(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "file-exists" }>,
): PredicateEvalResult {
  const absolute = join(workingDir, predicate.path);
  const exists = existsSync(absolute);
  return {
    predicate,
    passed: exists,
    detail: exists ? `file exists: ${predicate.path}` : `file missing: ${predicate.path}`,
  };
}

function evaluateFileAbsent(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "file-absent" }>,
): PredicateEvalResult {
  const absolute = join(workingDir, predicate.path);
  const exists = existsSync(absolute);
  return {
    predicate,
    passed: !exists,
    detail: exists
      ? `file present but expected absent: ${predicate.path}`
      : `file absent as expected: ${predicate.path}`,
  };
}

function evaluateFileContains(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "file-contains" }>,
): PredicateEvalResult {
  const absolute = join(workingDir, predicate.path);
  if (!existsSync(absolute)) {
    return {
      predicate,
      passed: false,
      detail: `file missing, cannot check contents: ${predicate.path}`,
    };
  }
  const text = readFileSync(absolute, "utf-8");
  const found = text.includes(predicate.needle);
  return {
    predicate,
    passed: found,
    detail: found
      ? `file ${predicate.path} contains needle (${predicate.needle.length} chars)`
      : `file ${predicate.path} missing needle`,
  };
}

function evaluateShell(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "shell-succeeds" | "shell-fails" }>,
): PredicateEvalResult {
  const timeoutMs = resolvedShellTimeout(predicate.timeoutMs);
  const result = spawnSync(predicate.command, {
    shell: true,
    cwd: workingDir,
    timeout: timeoutMs,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const expectsSuccess = predicate.kind === "shell-succeeds";
  const timedOut = result.signal === "SIGTERM" || result.error?.message.includes("ETIMEDOUT");
  const succeeded = !timedOut && result.status === 0;
  const passed = expectsSuccess ? succeeded : !succeeded;
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const statusDesc = timedOut
    ? `timeout after ${timeoutMs}ms`
    : result.status === null
      ? `terminated by signal ${result.signal}`
      : `exit ${result.status}`;
  return {
    predicate,
    passed,
    detail: `${expectsSuccess ? "shell-succeeds" : "shell-fails"} "${predicate.command}" — ${statusDesc}\n${tail(combined, OUTPUT_TAIL_LIMIT)}`,
  };
}

export function evaluatePredicate(
  workingDir: string,
  predicate: FixturePredicate,
): PredicateEvalResult {
  switch (predicate.kind) {
    case "file-exists":
      return evaluateFileExists(workingDir, predicate);
    case "file-absent":
      return evaluateFileAbsent(workingDir, predicate);
    case "file-contains":
      return evaluateFileContains(workingDir, predicate);
    case "shell-succeeds":
    case "shell-fails":
      return evaluateShell(workingDir, predicate);
  }
}

/**
 * Evaluate a list of predicates against a working directory. The fixture
 * passes only when every predicate passes — this is the deterministic
 * pass/fail signal the scoring layer consumes.
 */
export function evaluatePredicates(
  workingDir: string,
  predicates: readonly FixturePredicate[],
): { passed: boolean; results: PredicateEvalResult[] } {
  const results = predicates.map((p) => evaluatePredicate(workingDir, p));
  return { passed: results.every((r) => r.passed), results };
}
