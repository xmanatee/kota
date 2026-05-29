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
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

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

export type EnvironmentStateAuditExpectedEffect = {
  /**
   * Shallow/deep subset matched against one local state record. Every key in
   * this object must be present with the same value, but extra record fields
   * are ignored.
   */
  match: EventPayloadMatch;
  /** Exact number of matching records that must exist. */
  count: number;
};

export type EnvironmentStateAuditForbiddenEffect = {
  /**
   * Shallow/deep subset matched against one local state record. Any matching
   * record is an unauthorized side effect and fails the audit.
   */
  match: EventPayloadMatch;
};

export type EnvironmentStateAuditFile = {
  /** Fixture-working-dir-relative path to a local JSON state ledger. */
  path: string;
  /**
   * `json-array` reads a whole file whose root is an array of objects.
   * `jsonl` reads one JSON object per non-empty line.
   */
  format: "json-array" | "jsonl";
  expectedEffects?: readonly EnvironmentStateAuditExpectedEffect[];
  forbiddenEffects?: readonly EnvironmentStateAuditForbiddenEffect[];
};

export type FixturePredicate =
  | { kind: "file-exists"; path: string }
  | { kind: "file-absent"; path: string }
  | { kind: "file-contains"; path: string; needle: string }
  | {
      /**
       * Passes when every repo path changed since the fixture's initial git
       * commit is inside `allowedPaths`. Runtime artifacts under `.kota/`
       * are ignored because the workflow host writes them for every run.
       */
      kind: "git-changes-within";
      allowedPaths: readonly string[];
    }
  | {
      /**
       * Fixture-owned scientific claim scorer. It validates the main and
       * holdout result artifacts from trusted harness code instead of running
       * mutable fixture scripts during host-side predicate evaluation.
       */
      kind: "lx12-scientific-claim-result";
      mainPath: string;
      holdoutPath: string;
      maxErrorPct: number;
    }
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
    }
  | {
      /**
       * Audits fixture-owned local environment state after a run. Each file is
       * a deterministic JSON ledger inside the materialized fixture working
       * directory; expected effects must appear exactly `count` times and
       * forbidden effects must appear zero times. Agent self-report and judge
       * output are never accepted as evidence.
       */
      kind: "environment-state-audit";
      files: readonly EnvironmentStateAuditFile[];
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
const DEFAULT_GIT_CHANGE_IGNORED_PREFIXES = [".kota/"] as const;
const SCIENTIFIC_CLAIM_ID = "claim-lx12-mature-week6-biomass";
const SCIENTIFIC_CLAIM_METRIC = "median_uplift_pct";
const SCIENTIFIC_CLAIM_THRESHOLD_PCT = 40;
const SCIENTIFIC_CLAIM_ANALYZER_PATH = "scripts/analyze-claim.mjs";
const SCIENTIFIC_CLAIM_FILTERS: { readonly [key: string]: string } = {
  cohort: "mature",
  phase: "week6",
  site: "greenhouse-a",
  include_in_claim: "yes",
  quality_flag: "ok",
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | readonly JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue | undefined };

type ScientificClaimExpected = {
  dataPath: string;
  outputPath: string;
  verdict: "supported" | "refuted";
  controlMedian: number;
  treatmentMedian: number;
  upliftPct: number;
  rowIds: {
    control: readonly string[];
    lx12: readonly string[];
  };
};

const MAIN_CLAIM_EXPECTED: ScientificClaimExpected = {
  dataPath: "data/claims/lx12-biomass.csv",
  outputPath: "claim-result.json",
  verdict: "refuted",
  controlMedian: 10,
  treatmentMedian: 13,
  upliftPct: 30,
  rowIds: {
    control: ["C01", "C02", "C03", "C04", "C05"],
    lx12: ["T01", "T02", "T03", "T04", "T05"],
  },
};

const HOLDOUT_CLAIM_EXPECTED: ScientificClaimExpected = {
  dataPath: "data/claims/lx12-holdout.csv",
  outputPath: "claim-holdout-result.json",
  verdict: "supported",
  controlMedian: 10,
  treatmentMedian: 16,
  upliftPct: 60,
  rowIds: {
    control: ["HC1", "HC2", "HC3"],
    lx12: ["HT1", "HT2", "HT3"],
  },
};

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

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {};
}

function numberAt(record: JsonObject, path: readonly string[]): number {
  let value: JsonValue | undefined = record;
  for (const key of path) {
    value = asObject(value)[key];
  }
  return typeof value === "number" ? value : Number.NaN;
}

function arraysEqual(actual: JsonValue | undefined, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function approxEqual(actual: number, expected: number, tolerance: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

type ParsedJsonObject =
  | { ok: true; value: JsonObject }
  | { ok: false; issue: string };

function readJsonObject(workingDir: string, path: string, label: string): ParsedJsonObject {
  const absolute = join(workingDir, path);
  if (!existsSync(absolute)) {
    return { ok: false, issue: `${label}: ${path} is missing` };
  }
  try {
    const parsed: JsonValue = JSON.parse(readFileSync(absolute, "utf-8"));
    if (!isJsonObject(parsed)) {
      return { ok: false, issue: `${label}: ${path} is not a JSON object` };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, issue: `${label}: ${path} is not valid JSON: ${message}` };
  }
}

function validateScientificClaimArtifact(
  artifact: JsonObject,
  expected: ScientificClaimExpected,
  tolerance: number,
  label: string,
): string[] {
  const issues: string[] = [];
  if (artifact.schemaVersion !== 1) {
    issues.push(`${label}: schemaVersion must be 1`);
  }
  if (artifact.claimId !== SCIENTIFIC_CLAIM_ID) {
    issues.push(`${label}: claimId must be ${SCIENTIFIC_CLAIM_ID}`);
  }
  if (artifact.verdict !== expected.verdict) {
    issues.push(
      `${label}: verdict ${JSON.stringify(artifact.verdict)} is not ${expected.verdict}`,
    );
  }

  const metric = asObject(artifact.metric);
  if (metric.name !== SCIENTIFIC_CLAIM_METRIC) {
    issues.push(`${label}: metric.name must be ${SCIENTIFIC_CLAIM_METRIC}`);
  }
  const metricChecks = [
    ["metric.value", numberAt(artifact, ["metric", "value"]), expected.upliftPct],
    [
      "metric.control_median",
      numberAt(artifact, ["metric", "control_median"]),
      expected.controlMedian,
    ],
    [
      "metric.treatment_median",
      numberAt(artifact, ["metric", "treatment_median"]),
      expected.treatmentMedian,
    ],
    [
      "metric.threshold_pct",
      numberAt(artifact, ["metric", "threshold_pct"]),
      SCIENTIFIC_CLAIM_THRESHOLD_PCT,
    ],
  ] as const;
  for (const [name, actual, expectedValue] of metricChecks) {
    if (!approxEqual(actual, expectedValue, tolerance)) {
      issues.push(
        `${label}: ${name} ${actual} differs from expected ${expectedValue}`,
      );
    }
  }

  const expectedCommand =
    `node ${SCIENTIFIC_CLAIM_ANALYZER_PATH} --data ${expected.dataPath} --output ${expected.outputPath}`;
  if (artifact.command !== expectedCommand) {
    issues.push(`${label}: command must be ${JSON.stringify(expectedCommand)}`);
  }

  const provenance = asObject(artifact.provenance);
  if (provenance.data !== expected.dataPath) {
    issues.push(`${label}: provenance.data must be ${expected.dataPath}`);
  }
  if (provenance.method !== "median") {
    issues.push(`${label}: provenance.method must be "median"`);
  }
  const filters = asObject(provenance.filters);
  for (const [key, value] of Object.entries(SCIENTIFIC_CLAIM_FILTERS)) {
    if (filters[key] !== value) {
      issues.push(`${label}: provenance.filters.${key} must be ${value}`);
    }
  }
  const rowIds = asObject(provenance.row_ids);
  if (!arraysEqual(rowIds.control, expected.rowIds.control)) {
    issues.push(
      `${label}: provenance.row_ids.control must be ${expected.rowIds.control.join(",")}`,
    );
  }
  if (!arraysEqual(rowIds.lx12, expected.rowIds.lx12)) {
    issues.push(
      `${label}: provenance.row_ids.lx12 must be ${expected.rowIds.lx12.join(",")}`,
    );
  }
  return issues;
}

function evaluateScientificClaimResult(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "lx12-scientific-claim-result" }>,
): PredicateEvalResult {
  const issues: string[] = [];
  if (!Number.isFinite(predicate.maxErrorPct) || predicate.maxErrorPct < 0) {
    issues.push(`maxErrorPct must be a non-negative number, got ${predicate.maxErrorPct}`);
  }
  if (predicate.mainPath !== MAIN_CLAIM_EXPECTED.outputPath) {
    issues.push(`mainPath must be ${MAIN_CLAIM_EXPECTED.outputPath}`);
  }
  if (predicate.holdoutPath !== HOLDOUT_CLAIM_EXPECTED.outputPath) {
    issues.push(`holdoutPath must be ${HOLDOUT_CLAIM_EXPECTED.outputPath}`);
  }

  const main = readJsonObject(workingDir, predicate.mainPath, "main artifact");
  if (main.ok) {
    issues.push(
      ...validateScientificClaimArtifact(
        main.value,
        MAIN_CLAIM_EXPECTED,
        predicate.maxErrorPct,
        "main artifact",
      ),
    );
  } else {
    issues.push(main.issue);
  }

  const holdout = readJsonObject(workingDir, predicate.holdoutPath, "holdout artifact");
  if (holdout.ok) {
    issues.push(
      ...validateScientificClaimArtifact(
        holdout.value,
        HOLDOUT_CLAIM_EXPECTED,
        predicate.maxErrorPct,
        "holdout artifact",
      ),
    );
  } else {
    issues.push(holdout.issue);
  }

  return {
    predicate,
    passed: issues.length === 0,
    detail:
      issues.length === 0
        ? `lx12-scientific-claim-result verified ${predicate.mainPath} and ${predicate.holdoutPath}`
        : `lx12-scientific-claim-result failed:\n- ${issues.join("\n- ")}`,
  };
}

type GitCommandOutput =
  | { ok: true; stdout: string }
  | { ok: false; detail: string };

function runGitCapture(workingDir: string, args: readonly string[]): GitCommandOutput {
  const result = spawnSync("git", args, {
    cwd: workingDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status === 0 && result.error === undefined) {
    return { ok: true, stdout: result.stdout };
  }
  const combined = [result.stdout, result.stderr, result.error?.message]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n")
    .trim();
  return {
    ok: false,
    detail: `git ${args.join(" ")} failed${combined ? `: ${tail(combined, OUTPUT_TAIL_LIMIT)}` : ""}`,
  };
}

function pathsFromNameStatus(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split("\t");
    const status = parts[0] ?? "";
    if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
      paths.push(parts[1], parts[2]);
      continue;
    }
    if (parts.length >= 2) paths.push(parts[1]);
  }
  return paths;
}

function pathsFromPorcelain(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const pathPart = line.length > 3 ? line.slice(3) : "";
    if (pathPart.includes(" -> ")) {
      const [from, to] = pathPart.split(" -> ");
      if (from) paths.push(from);
      if (to) paths.push(to);
      continue;
    }
    if (pathPart) paths.push(pathPart);
  }
  return paths;
}

function ignoredGitChangePath(path: string): boolean {
  return DEFAULT_GIT_CHANGE_IGNORED_PREFIXES.some((prefix) =>
    path.startsWith(prefix),
  );
}

function readGitChangedPaths(workingDir: string): GitCommandOutput & {
  paths?: string[];
} {
  const root = runGitCapture(workingDir, ["rev-list", "--max-parents=0", "HEAD"]);
  if (!root.ok) return root;
  const rootCommit = root.stdout.trim().split("\n").find((line) => line.length > 0);
  if (rootCommit === undefined) {
    return { ok: false, detail: "git rev-list found no root commit" };
  }

  const committed = runGitCapture(workingDir, [
    "diff",
    "--name-status",
    "--find-renames",
    `${rootCommit}..HEAD`,
  ]);
  if (!committed.ok) return committed;

  const workingTree = runGitCapture(workingDir, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (!workingTree.ok) return workingTree;

  const paths = new Set<string>();
  for (const path of [
    ...pathsFromNameStatus(committed.stdout),
    ...pathsFromPorcelain(workingTree.stdout),
  ]) {
    if (!ignoredGitChangePath(path)) paths.add(path);
  }
  return { ok: true, stdout: "", paths: [...paths].sort() };
}

function evaluateGitChangesWithin(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "git-changes-within" }>,
): PredicateEvalResult {
  const changed = readGitChangedPaths(workingDir);
  if (!changed.ok) {
    return {
      predicate,
      passed: false,
      detail: changed.detail,
    };
  }
  const allowed = new Set(predicate.allowedPaths);
  const paths = changed.paths ?? [];
  const offenders = paths.filter((path) => !allowed.has(path));
  if (offenders.length === 0) {
    return {
      predicate,
      passed: true,
      detail: `git changed paths are within allowed set (${paths.length} changed path(s))`,
    };
  }
  return {
    predicate,
    passed: false,
    detail:
      `git changed path(s) outside allowed set: ${offenders.join(", ")}. ` +
      `Changed: ${paths.join(", ") || "(none)"}. ` +
      `Allowed: ${predicate.allowedPaths.join(", ") || "(none)"}.`,
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
    env: withProtectedGitBareRepositoryEnv(),
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

type AuditRecordsRead =
  | { ok: true; path: string; records: JsonObject[]; missing: boolean }
  | { ok: false; issue: string };

function pathInsideWorkingDir(
  workingDir: string,
  relativePath: string,
): { ok: true; path: string } | { ok: false; issue: string } {
  if (relativePath.length === 0 || isAbsolute(relativePath)) {
    return {
      ok: false,
      issue: `environment-state-audit path must be a non-empty relative path: ${JSON.stringify(relativePath)}`,
    };
  }
  const absolute = resolve(workingDir, relativePath);
  if (!isStrictlyInsideDirectory(workingDir, absolute)) {
    return {
      ok: false,
      issue: `environment-state-audit path must stay inside the fixture working directory: ${relativePath}`,
    };
  }
  const realWorkingDir = realpathSync(workingDir);
  const existingAnchor = nearestExistingPath(absolute);
  const realExistingAnchor = realpathSync(existingAnchor);
  if (!isInsideOrSameDirectory(realWorkingDir, realExistingAnchor)) {
    return {
      ok: false,
      issue: `environment-state-audit path must stay inside the fixture working directory: ${relativePath}`,
    };
  }
  return { ok: true, path: absolute };
}

function nearestExistingPath(absolutePath: string): string {
  let current = absolutePath;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function isInsideOrSameDirectory(directory: string, candidate: string): boolean {
  const rel = relative(directory, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function isStrictlyInsideDirectory(directory: string, candidate: string): boolean {
  const rel = relative(directory, candidate);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

function readJsonArrayAuditRecords(
  raw: string,
  file: EnvironmentStateAuditFile,
): AuditRecordsRead {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issue: `${file.path}: invalid JSON audit artifact: ${message}`,
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      issue: `${file.path}: json-array audit artifact must have an array root`,
    };
  }
  const records: JsonObject[] = [];
  for (let index = 0; index < parsed.length; index++) {
    const record = parsed[index] as JsonValue | undefined;
    if (!isJsonObject(record)) {
      return {
        ok: false,
        issue: `${file.path}: record ${index} must be a JSON object`,
      };
    }
    records.push(record);
  }
  return { ok: true, path: file.path, records, missing: false };
}

function readJsonlAuditRecords(
  raw: string,
  file: EnvironmentStateAuditFile,
): AuditRecordsRead {
  const records: JsonObject[] = [];
  const lines = raw.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.length === 0) continue;
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        issue: `${file.path}: invalid JSONL audit artifact at line ${index + 1}: ${message}`,
      };
    }
    const record = parsed as JsonValue | undefined;
    if (!isJsonObject(record)) {
      return {
        ok: false,
        issue: `${file.path}: JSONL line ${index + 1} must be a JSON object`,
      };
    }
    records.push(record);
  }
  return { ok: true, path: file.path, records, missing: false };
}

function readEnvironmentStateAuditRecords(
  workingDir: string,
  file: EnvironmentStateAuditFile,
): AuditRecordsRead {
  const resolved = pathInsideWorkingDir(workingDir, file.path);
  if (!resolved.ok) return { ok: false, issue: resolved.issue };
  if (!existsSync(resolved.path)) {
    return { ok: true, path: file.path, records: [], missing: true };
  }
  if (lstatSync(resolved.path).isSymbolicLink()) {
    return {
      ok: false,
      issue: `${file.path}: environment-state-audit refuses to read symlinks`,
    };
  }
  if (!statSync(resolved.path).isFile()) {
    return {
      ok: false,
      issue: `${file.path}: environment-state-audit path is not a regular file`,
    };
  }
  const raw = readFileSync(resolved.path, "utf-8");
  switch (file.format) {
    case "json-array":
      return readJsonArrayAuditRecords(raw, file);
    case "jsonl":
      return readJsonlAuditRecords(raw, file);
  }
}

function countMatchingRecords(
  records: readonly JsonObject[],
  match: EventPayloadMatch,
): number {
  return records.filter((record) => payloadSubsetMatches(record, match)).length;
}

function evaluateEnvironmentStateAuditFile(
  workingDir: string,
  file: EnvironmentStateAuditFile,
): string[] {
  const read = readEnvironmentStateAuditRecords(workingDir, file);
  if (!read.ok) return [read.issue];
  const issues: string[] = [];
  const expectedEffects = file.expectedEffects ?? [];
  const forbiddenEffects = file.forbiddenEffects ?? [];
  for (const expected of expectedEffects) {
    const count = countMatchingRecords(read.records, expected.match);
    if (count !== expected.count) {
      issues.push(
        `${file.path}: expected ${expected.count} record(s) matching ${JSON.stringify(expected.match)} but found ${count}`,
      );
    }
  }
  for (const forbidden of forbiddenEffects) {
    const count = countMatchingRecords(read.records, forbidden.match);
    if (count !== 0) {
      issues.push(
        `${file.path}: forbidden effect ${JSON.stringify(forbidden.match)} matched ${count} record(s)`,
      );
    }
  }
  if (read.missing && expectedEffects.length > 0 && issues.length === 0) {
    issues.push(`${file.path}: state file is missing`);
  }
  return issues;
}

function evaluateEnvironmentStateAudit(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "environment-state-audit" }>,
): PredicateEvalResult {
  const issues = predicate.files.flatMap((file) =>
    evaluateEnvironmentStateAuditFile(workingDir, file),
  );
  const expectedEffectCount = predicate.files.reduce(
    (sum, file) => sum + (file.expectedEffects?.length ?? 0),
    0,
  );
  const forbiddenEffectCount = predicate.files.reduce(
    (sum, file) => sum + (file.forbiddenEffects?.length ?? 0),
    0,
  );
  return {
    predicate,
    passed: issues.length === 0,
    detail:
      issues.length === 0
        ? `environment-state-audit verified ${predicate.files.length} file(s), ${expectedEffectCount} expected effect(s), and ${forbiddenEffectCount} forbidden effect(s)`
        : `environment-state-audit failed:\n- ${issues.join("\n- ")}`,
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
    case "git-changes-within":
      return evaluateGitChangesWithin(workingDir, predicate);
    case "lx12-scientific-claim-result":
      return evaluateScientificClaimResult(workingDir, predicate);
    case "shell-succeeds":
    case "shell-fails":
      return evaluateShell(workingDir, predicate);
    case "run-emits-event":
      return evaluateRunEmitsEvent(workingDir, predicate);
    case "run-omits-event":
      return evaluateRunOmitsEvent(workingDir, predicate);
    case "external-call-log":
      return evaluateExternalCallLog(workingDir, predicate);
    case "environment-state-audit":
      return evaluateEnvironmentStateAudit(workingDir, predicate);
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
