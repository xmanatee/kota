import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
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

function gitOutput(projectDir: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function hasHead(projectDir: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error !== undefined) throw result.error;
  return result.status === 0;
}

/**
 * Returns the set of repo paths a workflow run would commit via `git add -A`.
 * Covers tracked modifications, deletions, both sides of renames, staged
 * additions, and non-ignored untracked files. This is the single path set
 * shared by writeScope enforcement and the workflow commit step, so an
 * untracked out-of-scope file fails the ownership gate instead of sneaking
 * into the commit.
 */
export function listWorkflowMutatedPaths(projectDir: string): string[] {
  gitOutput(projectDir, ["rev-parse", "--is-inside-work-tree"]);
  const tracked = hasHead(projectDir)
    ? [gitOutput(projectDir, ["diff", "--name-only", "--no-renames", "HEAD"])]
    : [
        gitOutput(projectDir, ["diff", "--cached", "--name-only", "--no-renames"]),
        gitOutput(projectDir, ["diff", "--name-only", "--no-renames"]),
      ];
  const untracked = gitOutput(projectDir, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  const paths = new Set<string>();
  for (const line of [...tracked.flatMap((out) => out.split("\n")), ...untracked.split("\n")]) {
    const trimmed = line.trim();
    if (trimmed.length > 0) paths.add(trimmed);
  }
  return [...paths].sort();
}

export function tryListWorkflowMutatedPaths(
  projectDir: string,
): string[] | undefined {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0 || result.stdout.trim() !== "true") return undefined;
  return listWorkflowMutatedPaths(projectDir);
}

/**
 * Attribute only paths this step actually mutated.
 *
 * `pre` is the mutated-path set captured before the step ran; `post` is
 * the set after. A path present in `pre` is carried over from a prior
 * (or concurrent) step and is not attributable to this step, even if
 * its content changed. A path present only in `post` is new in this
 * step and belongs to it.
 *
 * Content-only re-writes of pre-existing dirty paths are conservatively
 * excluded. In practice prior steps do not pre-mutate files the agent
 * would also touch, and declaring whole-repo diffs as this step's fault
 * is the worse failure mode — it cross-blames between concurrent
 * workflows and loses the invariant that a step's write-scope violation
 * names paths that step wrote.
 */
export function diffMutatedPaths(
  pre: readonly string[],
  post: readonly string[],
): string[] {
  const preSet = new Set(pre);
  return post.filter((path) => !preSet.has(path)).sort();
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
