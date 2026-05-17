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

/**
 * Argv-shape matcher for an `external-call-log` predicate. Three small
 * matchers cover the matching tolerance fixtures actually need today; new
 * shapes extend the union only on demonstrated need (no parallel DSL).
 *
 *  - `argv-equals` — invocation argv (post-binary) must equal this list,
 *    element by element. Use when the assertion needs to pin the full
 *    command shape.
 *  - `argv-prefix` — invocation argv (post-binary) must start with this
 *    list. Use when the meaningful portion of the command is the leading
 *    subcommand and flags are advisory.
 *  - `argv-includes` — invocation argv (post-binary) must contain this
 *    exact token at any position. Use when the meaningful assertion is
 *    "this command was invoked with this specific arg".
 */
export type ExternalCallArgvMatch =
  | { kind: "argv-equals"; argv: readonly string[] }
  | { kind: "argv-prefix"; argv: readonly string[] }
  | { kind: "argv-includes"; arg: string };

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
    }
  | {
      /**
       * Passes when at least one entry in
       * `<workingDir>/.kota/external-calls/<binary>.jsonl` matches the
       * argv shape (and, when set, the exit-code class). Each line is one
       * recorded out-of-process invocation written by the fixture-scoped
       * shim — see `external-call-shim.ts`. The predicate runs against
       * the same JSONL log whether the line was written by a live shim
       * call (real LLM run) or by an agent-step recording's
       * `fileOperations` (replay path), so one assertion covers both
       * paths. The shim records argv exactly as observed; this predicate
       * is responsible for any matching tolerance it wants to express.
       */
      kind: "external-call-log";
      binary: string;
      match: ExternalCallArgvMatch;
      /**
       * Optional exit-code class. Default is "any" (no exit-code
       * constraint). When set, the matching invocation's recorded exit
       * code must fall in the named class.
       */
      exitClass?: "zero" | "non-zero";
    };

export type PredicateEvalResult = {
  predicate: FixturePredicate;
  passed: boolean;
  /** Short explanation — always present, for artifact readability. */
  detail: string;
};

export type PredicateExpectedResult = "pass" | "fail";

export type FixturePredicateExpectation = {
  predicate: FixturePredicate;
  expected: PredicateExpectedResult;
};

export type PredicateExpectationEvalResult = {
  predicate: FixturePredicate;
  expected: PredicateExpectedResult;
  actual: PredicateExpectedResult;
  passed: boolean;
  /** Whether the underlying predicate passed before expectation inversion. */
  predicatePassed: boolean;
  predicateDetail: string;
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

type ExternalCallEntry = {
  binary: string;
  argv: string[];
  exitCode: number;
};

/**
 * Read every recorded invocation for a binary from
 * `<workingDir>/.kota/external-calls/<binary>.jsonl`. Returns an empty list
 * when the log file does not exist (binary was never invoked). Malformed
 * lines fail loudly — a corrupt log is not a silent pass signal, it is a
 * shim or recording bug the operator needs to see.
 */
function readExternalCallLogEntries(
  workingDir: string,
  binary: string,
): ExternalCallEntry[] {
  const logPath = join(workingDir, ".kota", "external-calls", `${binary}.jsonl`);
  if (!existsSync(logPath)) return [];
  if (!statSync(logPath).isFile()) {
    throw new Error(
      `external-call log path ${logPath} exists but is not a regular file.`,
    );
  }
  const raw = readFileSync(logPath, "utf-8");
  const entries: ExternalCallEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parsed = JSON.parse(trimmed) as {
      binary?: unknown;
      argv?: unknown;
      exitCode?: unknown;
    };
    if (typeof parsed.binary !== "string") {
      throw new Error(
        `Malformed entry in ${logPath}: missing "binary" string.`,
      );
    }
    if (
      !Array.isArray(parsed.argv) ||
      !parsed.argv.every((s) => typeof s === "string")
    ) {
      throw new Error(
        `Malformed entry in ${logPath}: "argv" must be an array of strings.`,
      );
    }
    if (typeof parsed.exitCode !== "number" || !Number.isFinite(parsed.exitCode)) {
      throw new Error(
        `Malformed entry in ${logPath}: "exitCode" must be a finite number.`,
      );
    }
    entries.push({
      binary: parsed.binary,
      argv: parsed.argv as string[],
      exitCode: parsed.exitCode,
    });
  }
  return entries;
}

function argvMatchesShape(
  argv: readonly string[],
  match: ExternalCallArgvMatch,
): boolean {
  switch (match.kind) {
    case "argv-equals":
      return (
        argv.length === match.argv.length &&
        argv.every((token, i) => token === match.argv[i])
      );
    case "argv-prefix":
      return (
        argv.length >= match.argv.length &&
        match.argv.every((token, i) => argv[i] === token)
      );
    case "argv-includes":
      return argv.includes(match.arg);
  }
}

function describeMatch(match: ExternalCallArgvMatch): string {
  switch (match.kind) {
    case "argv-equals":
      return `argv-equals ${JSON.stringify(match.argv)}`;
    case "argv-prefix":
      return `argv-prefix ${JSON.stringify(match.argv)}`;
    case "argv-includes":
      return `argv-includes ${JSON.stringify(match.arg)}`;
  }
}

function exitCodeMatchesClass(
  exitCode: number,
  expected: "zero" | "non-zero" | undefined,
): boolean {
  if (expected === undefined) return true;
  return expected === "zero" ? exitCode === 0 : exitCode !== 0;
}

function evaluateExternalCallLog(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "external-call-log" }>,
): PredicateEvalResult {
  const entries = readExternalCallLogEntries(workingDir, predicate.binary);
  const sameBinary = entries.filter((e) => e.binary === predicate.binary);
  if (sameBinary.length === 0) {
    return {
      predicate,
      passed: false,
      detail: `external-call-log: ${JSON.stringify(predicate.binary)} was never invoked (log file ${predicate.binary}.jsonl is missing or empty).`,
    };
  }
  const argvMatches = sameBinary.filter((e) =>
    argvMatchesShape(e.argv, predicate.match),
  );
  if (argvMatches.length === 0) {
    const observed = sameBinary
      .slice(0, 5)
      .map((e) => JSON.stringify(e.argv))
      .join(", ");
    return {
      predicate,
      passed: false,
      detail: `external-call-log: ${sameBinary.length} ${predicate.binary} invocation(s) recorded but none match ${describeMatch(predicate.match)}. Observed: ${observed}`,
    };
  }
  const exitClass = predicate.exitClass;
  if (exitClass !== undefined) {
    const exitMatches = argvMatches.filter((e) =>
      exitCodeMatchesClass(e.exitCode, exitClass),
    );
    if (exitMatches.length === 0) {
      const observedExits = argvMatches.slice(0, 5).map((e) => e.exitCode).join(", ");
      return {
        predicate,
        passed: false,
        detail: `external-call-log: ${argvMatches.length} ${predicate.binary} invocation(s) matched ${describeMatch(predicate.match)} but exitClass=${exitClass} did not match. Observed exit codes: ${observedExits}`,
      };
    }
    return {
      predicate,
      passed: true,
      detail: `external-call-log: ${exitMatches.length} ${predicate.binary} invocation(s) matched ${describeMatch(predicate.match)} with exitClass=${exitClass}.`,
    };
  }
  return {
    predicate,
    passed: true,
    detail: `external-call-log: ${argvMatches.length} ${predicate.binary} invocation(s) matched ${describeMatch(predicate.match)}.`,
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
    case "external-call-log":
      return evaluateExternalCallLog(workingDir, predicate);
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

export function evaluatePredicateExpectations(
  workingDir: string,
  expectations: readonly FixturePredicateExpectation[],
): { passed: boolean; results: PredicateExpectationEvalResult[] } {
  const results = expectations.map((expectation) => {
    const predicateResult = evaluatePredicate(workingDir, expectation.predicate);
    const actual: PredicateExpectedResult = predicateResult.passed ? "pass" : "fail";
    const passed = actual === expectation.expected;
    return {
      predicate: expectation.predicate,
      expected: expectation.expected,
      actual,
      passed,
      predicatePassed: predicateResult.passed,
      predicateDetail: predicateResult.detail,
      detail: passed
        ? `initial predicate ${actual} matched expected ${expectation.expected}: ${predicateResult.detail}`
        : `initial predicate ${actual} did not match expected ${expectation.expected}: ${predicateResult.detail}`,
    };
  });
  return { passed: results.every((r) => r.passed), results };
}
