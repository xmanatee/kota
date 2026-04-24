/**
 * Pass/fail predicates for autonomy eval-harness fixtures.
 *
 * Predicates inspect actual repo state (file contents, shell exit codes) or
 * workflow-runtime artifacts (bus-event logs) after a fixture run, never the
 * agent's self-report. The DSL is deliberately small and boringly
 * deterministic: the harness is a measurement device, not a second test
 * framework. If a fixture needs richer verification, add a new predicate kind
 * here rather than pushing logic into the fixture author.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Shallow/deep subset match applied to an event payload. Every key in the
 * match object must be present in the emitted payload with an equal value;
 * unspecified payload keys are ignored. Nested objects match structurally,
 * arrays match by deep equality (length + ordered element equality).
 */
export type EventPayloadMatch = Record<string, unknown>;

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
    }
  | {
      /**
       * Passes when at least one emitted event with the given name is
       * recorded under `.kota/runs/<id>/emitted-events.jsonl` in the working
       * directory. When `payloadMatch` is set, the matching emission must
       * also match the provided subset shape. When `workflow` is set, only
       * runs whose directory name includes the workflow name are scanned —
       * this keeps fixtures with a crowded run history honest.
       */
      kind: "run-emits-event";
      event: string;
      workflow?: string;
      payloadMatch?: EventPayloadMatch;
    }
  | {
      /**
       * Passes when no run in the working directory recorded an emission
       * with the given event name. `workflow` narrows scanning the same way
       * as `run-emits-event`. Use this to assert the negative — that a
       * conditional emission did NOT fire given the seeded repo state.
       */
      kind: "run-omits-event";
      event: string;
      workflow?: string;
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

type EmittedEventEntry = {
  event: string;
  payload: unknown;
};

function payloadSubsetMatches(candidate: unknown, match: unknown): boolean {
  if (match === null || typeof match !== "object" || Array.isArray(match)) {
    return deepEqual(candidate, match);
  }
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }
  const matchObj = match as Record<string, unknown>;
  const candObj = candidate as Record<string, unknown>;
  for (const key of Object.keys(matchObj)) {
    if (!(key in candObj)) return false;
    if (!payloadSubsetMatches(candObj[key], matchObj[key])) return false;
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object"
  ) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = Object.keys(aObj);
    if (keys.length !== Object.keys(bObj).length) return false;
    for (const k of keys) {
      if (!deepEqual(aObj[k], bObj[k])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Read every `emitted-events.jsonl` produced by runs under the working
 * directory. Returns an empty array when no runs exist yet. Malformed lines
 * fail loudly — a corrupt event log is not a silent pass signal, it is a
 * harness or workflow-runtime bug the operator needs to see.
 */
function readEmittedEventsFromRuns(
  workingDir: string,
  workflowFilter: string | undefined,
): EmittedEventEntry[] {
  const runsDir = join(workingDir, ".kota", "runs");
  if (!existsSync(runsDir)) return [];
  const entries: EmittedEventEntry[] = [];
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (workflowFilter !== undefined && !entry.name.includes(workflowFilter)) {
      continue;
    }
    const logPath = join(runsDir, entry.name, "emitted-events.jsonl");
    if (!existsSync(logPath)) continue;
    if (!statSync(logPath).isFile()) continue;
    const raw = readFileSync(logPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parsed = JSON.parse(trimmed) as { event?: unknown; payload?: unknown };
      if (typeof parsed.event !== "string") {
        throw new Error(
          `Malformed entry in ${logPath}: missing "event" string.`,
        );
      }
      entries.push({ event: parsed.event, payload: parsed.payload });
    }
  }
  return entries;
}

function evaluateRunEmitsEvent(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "run-emits-event" }>,
): PredicateEvalResult {
  const events = readEmittedEventsFromRuns(workingDir, predicate.workflow);
  const candidates = events.filter((e) => e.event === predicate.event);
  if (candidates.length === 0) {
    return {
      predicate,
      passed: false,
      detail: `no emitted "${predicate.event}" found in${predicate.workflow ? ` ${predicate.workflow}` : ""} runs (scanned ${events.length} emissions)`,
    };
  }
  if (predicate.payloadMatch === undefined) {
    return {
      predicate,
      passed: true,
      detail: `found ${candidates.length} emission(s) of "${predicate.event}"`,
    };
  }
  const matching = candidates.find((e) =>
    payloadSubsetMatches(e.payload, predicate.payloadMatch),
  );
  if (matching !== undefined) {
    return {
      predicate,
      passed: true,
      detail: `emission of "${predicate.event}" matched payload subset`,
    };
  }
  return {
    predicate,
    passed: false,
    detail:
      `found ${candidates.length} emission(s) of "${predicate.event}" but none matched payload subset ${JSON.stringify(predicate.payloadMatch)}`,
  };
}

function evaluateRunOmitsEvent(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "run-omits-event" }>,
): PredicateEvalResult {
  const events = readEmittedEventsFromRuns(workingDir, predicate.workflow);
  const offenders = events.filter((e) => e.event === predicate.event);
  if (offenders.length === 0) {
    return {
      predicate,
      passed: true,
      detail: `no "${predicate.event}" emitted as expected (scanned ${events.length} emissions)`,
    };
  }
  return {
    predicate,
    passed: false,
    detail: `expected "${predicate.event}" to be absent but found ${offenders.length} emission(s)`,
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
    case "run-emits-event":
      return evaluateRunEmitsEvent(workingDir, predicate);
    case "run-omits-event":
      return evaluateRunOmitsEvent(workingDir, predicate);
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
