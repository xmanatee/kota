/**
 * Pass/fail predicates for autonomy eval-harness fixtures.
 *
 * Predicates inspect actual repo state (file contents, shell exit codes) after a fixture run, never the
 * agent's self-report. The DSL is deliberately small and boringly
 * deterministic: the harness is a measurement device, not a second test
 * framework. If a fixture needs richer verification, add a new predicate kind
 * here rather than pushing logic into the fixture author.
 */

import {
  existsSync,
  readFileSync,
} from "node:fs";
import { join, } from "node:path";
import type { ExecutableVerifier } from "./executable-verifier-sandbox.js";
import type { ScientificClaimAnalyzerSandbox } from "./scientific-claim-analyzer-sandbox.js";
import {
  evaluateScientificClaimResult,
  type ScientificClaimResultPredicate,
} from "./scientific-claim-predicate.js";

export type FixturePredicate =
  | { kind: "file-exists"; path: string }
  | { kind: "file-absent"; path: string }
  | { kind: "file-contains"; path: string; needle: string }
  | {
      /**
       * Passes when every repo path changed since the fixture's initial git
       * commit is inside `allowedPaths`. Runtime artifacts under
       * `.kota/runs/` are ignored because the workflow host writes them for
       * every run. Other tracked `.kota/` paths remain candidate-owned scope.
       */
      kind: "git-changes-within";
      allowedPaths: readonly string[];
    }
  | ScientificClaimResultPredicate
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
;

export type PredicateEvalResult = {
  predicate: FixturePredicate;
  passed: boolean;
  /** Short explanation — always present, for artifact readability. */
  detail: string;
  /** Exact observed paths for git-changes-within evidence. */
  changedPaths?: readonly string[];
};

export type PredicateEvaluationContext = {
  executableVerifier?: ExecutableVerifier;
  scientificClaimAnalyzerSandbox?: ScientificClaimAnalyzerSandbox;
};

const UNAVAILABLE_SCIENTIFIC_CLAIM_ANALYZER_SANDBOX = {
  kind: "unavailable",
  evidence: "analyzer resource isolation unavailable",
  issue:
    "scientific-claim analyzer verification has no configured resource-isolated container boundary",
} as const satisfies ScientificClaimAnalyzerSandbox;

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
const GIT_PREDICATE_TIMEOUT_MS = 30_000;
const GIT_PREDICATE_PREFIX =
  "git -c core.fsmonitor=false -c core.hooksPath=/dev/null --no-pager";
const DEFAULT_GIT_CHANGE_IGNORED_PREFIXES = [".kota/runs/"] as const;



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

type GitCommandOutput =
  | { ok: true; stdout: string }
  | { ok: false; detail: string };

async function runGitCapture(
  workingDir: string,
  verifier: ExecutableVerifier | undefined,
  label: string,
  command: string,
): Promise<GitCommandOutput> {
  if (verifier === undefined) {
    return {
      ok: false,
      detail:
        "git predicate requires a verified isolated verifier; refusing evaluator-host git execution",
    };
  }
  const execution = await verifier({
    workingDir,
    command,
    timeoutMs: GIT_PREDICATE_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (!execution.started) {
    return {
      ok: false,
      detail: `verified isolated verifier unavailable for ${label}: ${execution.issue}`,
    };
  }
  const { result } = execution;
  if (result.status === 0 && result.error === undefined) {
    return { ok: true, stdout: result.stdout };
  }
  const combined = [result.stdout, result.stderr, result.error?.message]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n")
    .trim();
  return {
    ok: false,
    detail: `${label} failed inside ${execution.isolation.evidence}${combined ? `: ${tail(combined, OUTPUT_TAIL_LIMIT)}` : ""}`,
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

async function readGitChangedPaths(
  workingDir: string,
  verifier: ExecutableVerifier | undefined,
): Promise<GitCommandOutput & {
  paths?: string[];
}> {
  const root = await runGitCapture(
    workingDir,
    verifier,
    "git rev-list",
    `${GIT_PREDICATE_PREFIX} rev-list --max-parents=0 HEAD`,
  );
  if (!root.ok) return root;
  const rootCommit = root.stdout.trim().split("\n").find((line) => line.length > 0);
  if (rootCommit === undefined) {
    return { ok: false, detail: "git rev-list found no root commit" };
  }
  if (!/^[0-9a-f]{40,64}$/i.test(rootCommit)) {
    return { ok: false, detail: "git rev-list returned an invalid root commit id" };
  }

  const committed = await runGitCapture(
    workingDir,
    verifier,
    "git diff",
    `${GIT_PREDICATE_PREFIX} diff --no-ext-diff --no-textconv --name-status --find-renames ${rootCommit}..HEAD`,
  );
  if (!committed.ok) return committed;

  const workingTree = await runGitCapture(
    workingDir,
    verifier,
    "git status",
    `${GIT_PREDICATE_PREFIX} status --porcelain=v1 --untracked-files=all`,
  );
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

async function evaluateGitChangesWithin(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "git-changes-within" }>,
  verifier: ExecutableVerifier | undefined,
): Promise<PredicateEvalResult> {
  const changed = await readGitChangedPaths(workingDir, verifier);
  if (!changed.ok) {
    return {
      predicate,
      passed: false,
      detail: changed.detail,
      changedPaths: [],
    };
  }
  const allowed = new Set(predicate.allowedPaths);
  const paths = changed.paths ?? [];
  const offenders = paths.filter((path) => !allowed.has(path));
  if (offenders.length === 0) {
    return {
      predicate,
      passed: true,
      detail:
        `git changed paths are within allowed set (${paths.length} changed path(s)). ` +
        `Changed: ${paths.join(", ") || "(none)"}.`,
      changedPaths: paths,
    };
  }
  return {
    predicate,
    passed: false,
    detail:
      `git changed path(s) outside allowed set: ${offenders.join(", ")}. ` +
      `Changed: ${paths.join(", ") || "(none)"}. ` +
      `Allowed: ${predicate.allowedPaths.join(", ") || "(none)"}.`,
    changedPaths: paths,
  };
}

async function evaluateShell(
  workingDir: string,
  predicate: Extract<FixturePredicate, { kind: "shell-succeeds" | "shell-fails" }>,
  verifier: ExecutableVerifier | undefined,
): Promise<PredicateEvalResult> {
  const timeoutMs = resolvedShellTimeout(predicate.timeoutMs);
  if (verifier === undefined) {
    return {
      predicate,
      passed: false,
      detail:
        "executable scoring requires a verified isolated verifier; refusing evaluator-host shell execution",
    };
  }
  const execution = await verifier({
    workingDir,
    command: predicate.command,
    timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (!execution.started) {
    return {
      predicate,
      passed: false,
      detail: `verified isolated verifier unavailable: ${execution.issue}`,
    };
  }
  const { result } = execution;
  const expectsSuccess = predicate.kind === "shell-succeeds";
  const timedOut = result.error?.name === "ETIMEDOUT";
  const completed =
    result.error === undefined && result.signal === null && result.status !== null;
  const succeeded = completed && result.status === 0;
  const passed = completed && (expectsSuccess ? succeeded : !succeeded);
  const combined = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join("\n");
  const statusDesc = timedOut
    ? `timeout after ${timeoutMs}ms`
    : result.status === null
      ? `terminated by signal ${result.signal}`
      : `exit ${result.status}`;
  return {
    predicate,
    passed,
    detail: `${expectsSuccess ? "shell-succeeds" : "shell-fails"} "${predicate.command}" inside ${execution.isolation.evidence} — ${statusDesc}\n${tail(combined, OUTPUT_TAIL_LIMIT)}`,
  };
}


type AsynchronousFixturePredicate =
  | ScientificClaimResultPredicate
  | Extract<
      FixturePredicate,
      { kind: "git-changes-within" | "shell-succeeds" | "shell-fails" }
    >;
type SynchronousFixturePredicate = Exclude<
  FixturePredicate,
  AsynchronousFixturePredicate
>;

export function evaluatePredicate(
  workingDir: string,
  predicate: AsynchronousFixturePredicate,
  context?: PredicateEvaluationContext,
): Promise<PredicateEvalResult>;
export function evaluatePredicate(
  workingDir: string,
  predicate: SynchronousFixturePredicate,
  context?: PredicateEvaluationContext,
): PredicateEvalResult;
export function evaluatePredicate(
  workingDir: string,
  predicate: FixturePredicate,
  context?: PredicateEvaluationContext,
): PredicateEvalResult | Promise<PredicateEvalResult>;
export function evaluatePredicate(
  workingDir: string,
  predicate: FixturePredicate,
  context: PredicateEvaluationContext = {},
): PredicateEvalResult | Promise<PredicateEvalResult> {
  switch (predicate.kind) {
    case "file-exists":
      return evaluateFileExists(workingDir, predicate);
    case "file-absent":
      return evaluateFileAbsent(workingDir, predicate);
    case "file-contains":
      return evaluateFileContains(workingDir, predicate);
    case "git-changes-within":
      return evaluateGitChangesWithin(
        workingDir,
        predicate,
        context.executableVerifier,
      );
    case "lx12-scientific-claim-result": {
      return evaluateScientificClaimResult(
        workingDir,
        predicate,
        context.scientificClaimAnalyzerSandbox ??
          UNAVAILABLE_SCIENTIFIC_CLAIM_ANALYZER_SANDBOX,
      ).then(
        (result): PredicateEvalResult => ({
          predicate,
          ...result,
        }),
      );
    }
    case "shell-succeeds":
    case "shell-fails":
      return evaluateShell(workingDir, predicate, context.executableVerifier);
  }
}

/**
 * Evaluate a list of predicates against a working directory. The fixture
 * passes only when every predicate passes — this is the deterministic
 * pass/fail signal the scoring layer consumes.
 */
export async function evaluatePredicates(
  workingDir: string,
  predicates: readonly FixturePredicate[],
  context: PredicateEvaluationContext = {},
): Promise<{ passed: boolean; results: PredicateEvalResult[] }> {
  const results: PredicateEvalResult[] = [];
  for (const predicate of predicates) {
    results.push(await evaluatePredicate(workingDir, predicate, context));
  }
  return { passed: results.every((r) => r.passed), results };
}

export async function evaluatePredicateExpectations(
  workingDir: string,
  expectations: readonly FixturePredicateExpectation[],
  context: PredicateEvaluationContext = {},
): Promise<{ passed: boolean; results: PredicateExpectationEvalResult[] }> {
  const results: PredicateExpectationEvalResult[] = [];
  for (const expectation of expectations) {
    const predicateResult = await evaluatePredicate(
      workingDir,
      expectation.predicate,
      context,
    );
    const actual: PredicateExpectedResult = predicateResult.passed ? "pass" : "fail";
    const passed = actual === expectation.expected;
    results.push({
      predicate: expectation.predicate,
      expected: expectation.expected,
      actual,
      passed,
      predicatePassed: predicateResult.passed,
      predicateDetail: predicateResult.detail,
      detail: passed
        ? `initial predicate ${actual} matched expected ${expectation.expected}: ${predicateResult.detail}`
        : `initial predicate ${actual} did not match expected ${expectation.expected}: ${predicateResult.detail}`,
    });
  }
  return { passed: results.every((r) => r.passed), results };
}
