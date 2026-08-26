import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AgentWriteScope } from "#core/agents/agent-types.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { readWorkspaceChanges } from "#core/workflow/workspace-change-evidence.js";
import type { WorkflowRunMetadata } from "../run-types.js";

const WORKFLOW_SCRATCH_ARTIFACT_PREFIXES = [".playwright-mcp/"] as const;
const WORKFLOW_SCRATCH_ARTIFACT_EXACT_PATHS = ["x-article-body.txt"] as const;
const WORKFLOW_SCRATCH_ARTIFACT_ROOTS = [".playwright-mcp"] as const;
const WORKFLOW_SCRATCH_ARTIFACT_EXACT_PATH_SET = new Set<string>(
  WORKFLOW_SCRATCH_ARTIFACT_EXACT_PATHS,
);

/**
 * Thrown when an agent step mutates tracked files outside its declared
 * `writeScope`. Propagates as a hard step failure — not classified as a
 * transient provider error and therefore not retryable.
 */
export class AgentWriteScopeViolationError extends Error {
  readonly stepId: string;
  readonly agentName: string;
  readonly scope: AgentWriteScope;
  readonly violations: readonly string[];

  constructor(args: {
    stepId: string;
    agentName: string;
    scope: AgentWriteScope;
    violations: readonly string[];
  }) {
    const scopeDisplay = args.scope === "deny-all"
      ? "<deny-all>"
      : args.scope.length === 0
        ? "<unrestricted>"
        : args.scope.join(", ");
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

function gitNulPaths(projectDir: string, args: readonly string[]): string[] {
  const output = gitOutput(projectDir, args);
  return output.length === 0 ? [] : output.slice(0, -1).split("\0");
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
  if (hasHead(projectDir)) {
    return readWorkspaceChanges(projectDir).map((change) => change.path);
  }
  const tracked = gitNulPaths(projectDir, [
    "diff",
    "--cached",
    "--name-only",
    "--no-renames",
    "-z",
  ]);
  const untracked = gitNulPaths(projectDir, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const paths = new Set<string>();
  for (const path of [...tracked, ...untracked]) paths.add(path);
  return [...paths].sort();
}

export function findWorkflowScratchArtifactPaths(
  paths: readonly string[],
): string[] {
  return paths
    .filter((path) =>
      WORKFLOW_SCRATCH_ARTIFACT_EXACT_PATH_SET.has(path) ||
      WORKFLOW_SCRATCH_ARTIFACT_PREFIXES.some((prefix) => path.startsWith(prefix))
    )
    .sort();
}

function trackedWorkflowScratchArtifacts(projectDir: string): Set<string> {
  let output = "";
  try {
    output = gitOutput(projectDir, [
      "ls-files",
      "--",
      ...WORKFLOW_SCRATCH_ARTIFACT_ROOTS,
      ...WORKFLOW_SCRATCH_ARTIFACT_EXACT_PATHS,
    ]);
  } catch {
    return new Set();
  }
  return new Set(output.split("\n").map((line) => line.trim()).filter(Boolean));
}

function hasTrackedPathUnder(root: string, trackedPaths: ReadonlySet<string>): boolean {
  for (const path of trackedPaths) {
    if (path === root || path.startsWith(`${root}/`)) return true;
  }
  return false;
}

export function removeWorkflowScratchArtifacts(projectDir: string): string[] {
  const trackedPaths = trackedWorkflowScratchArtifacts(projectDir);
  const removed: string[] = [];

  for (const root of WORKFLOW_SCRATCH_ARTIFACT_ROOTS) {
    if (hasTrackedPathUnder(root, trackedPaths)) continue;
    const absoluteRoot = resolve(projectDir, root);
    if (!existsSync(absoluteRoot)) continue;
    rmSync(absoluteRoot, { recursive: true, force: true });
    removed.push(root);
  }

  for (const path of WORKFLOW_SCRATCH_ARTIFACT_EXACT_PATHS) {
    if (trackedPaths.has(path)) continue;
    const absolutePath = resolve(projectDir, path);
    if (!existsSync(absolutePath)) continue;
    rmSync(absolutePath, { force: true });
    removed.push(path);
  }

  return removed.sort();
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

export function requiresWriteScopeSnapshot(scope: AgentWriteScope): boolean {
  return scope === "deny-all" || scope.length > 0;
}

/**
 * Filter the set of mutated tracked files down to those that fall outside
 * the declared writeScope. Sorted for stable output.
 */
export function findWriteScopeViolations(
  mutated: readonly string[],
  scope: AgentWriteScope,
  runtimeWriteScopes: readonly string[] = [],
): string[] {
  const projectMutations = runtimeWriteScopes.length === 0
    ? [...mutated]
    : mutated.filter((path) => !pathInScope(path, runtimeWriteScopes));
  if (scope === "deny-all") return projectMutations.sort();
  if (scope.length === 0) return [];
  return projectMutations.filter((path) => !pathInScope(path, scope)).sort();
}

/**
 * Persist a structured violation artifact next to the other per-step
 * artifacts so operator clients can show "this step tried to write these
 * out-of-scope paths" without parsing log text.
 */
export function writeWriteScopeViolationArtifact(args: {
  stepId: string;
  agentName: string;
  scope: AgentWriteScope;
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
