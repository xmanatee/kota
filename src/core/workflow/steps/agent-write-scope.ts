import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { WorkflowRunMetadata } from "../run-types.js";

/**
 * Thrown when an agent step mutates tracked files outside its declared
 * `writeScope`. Propagates as a hard step failure — not classified as a
 * transient provider error and therefore not retryable.
 */
export class AgentWriteScopeViolationError extends Error {
  readonly stepId: string;
  readonly agentName: string;
  readonly scope: readonly string[];
  readonly violations: readonly string[];

  constructor(args: {
    stepId: string;
    agentName: string;
    scope: readonly string[];
    violations: readonly string[];
  }) {
    const scopeDisplay =
      args.scope.length === 0 ? "<unrestricted>" : args.scope.join(", ");
    super(
      `Agent step "${args.stepId}" (${args.agentName}) wrote tracked files outside its declared writeScope [${scopeDisplay}]: ${args.violations.join(", ")}`,
    );
    this.name = "AgentWriteScopeViolationError";
    this.stepId = args.stepId;
    this.agentName = args.agentName;
    this.scope = args.scope;
    this.violations = args.violations;
  }
}

/**
 * Returns the tracked files that differ from HEAD in the project directory.
 * Covers both staged and unstaged modifications to tracked files and staged
 * additions of new files. Excludes untracked files (those are already gated
 * by the `no-scratch-artifacts` repair check).
 */
export function listMutatedTrackedFiles(projectDir: string): string[] {
  const output = execFileSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeScope(entry: string): string {
  return entry.endsWith("/") ? entry.slice(0, -1) : entry;
}

/**
 * True when `path` is in-scope for an agent with the given declared scope.
 * An empty scope is the explicit unrestricted declaration and admits every
 * path; a non-empty scope admits a path only when it equals some entry
 * exactly or sits under some entry's directory.
 */
export function pathInScope(path: string, scope: readonly string[]): boolean {
  if (scope.length === 0) return true;
  for (const raw of scope) {
    const entry = normalizeScope(raw);
    if (entry === path) return true;
    if (path.startsWith(`${entry}/`)) return true;
  }
  return false;
}

/**
 * Filter the set of mutated tracked files down to those that fall outside
 * the declared writeScope. Sorted for stable output.
 */
export function findWriteScopeViolations(
  mutated: readonly string[],
  scope: readonly string[],
): string[] {
  if (scope.length === 0) return [];
  return mutated.filter((path) => !pathInScope(path, scope)).sort();
}

/**
 * Persist a structured violation artifact next to the other per-step
 * artifacts so operator clients can show "this step tried to write these
 * out-of-scope paths" without parsing log text.
 */
export function writeWriteScopeViolationArtifact(args: {
  stepId: string;
  agentName: string;
  scope: readonly string[];
  violations: readonly string[];
  metadata: WorkflowRunMetadata;
  projectDir: string;
}): void {
  const filePath = join(
    resolve(args.projectDir, args.metadata.runDir),
    "steps",
    `${args.stepId}.write-scope-violation.json`,
  );
  mkdirSync(dirname(filePath), { recursive: true });
  const payload = {
    stepId: args.stepId,
    agentName: args.agentName,
    scope: args.scope,
    violations: args.violations,
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}
