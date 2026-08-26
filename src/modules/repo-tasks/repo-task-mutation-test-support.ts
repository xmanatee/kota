import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { createRunContext } from "#core/workflow/run-context.js";
import { RunSandboxManager } from "#core/workflow/run-sandbox.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { RepoTaskRuntimeSandboxTarget } from "./repo-task-mutation-boundary.js";

const runtimeTargets = new Map<string, RepoTaskRuntimeSandboxTarget>();

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", [...args], {
    cwd,
    env: withProtectedGitBareRepositoryEnv(),
    stdio: "ignore",
  });
}

export function createRepoTaskRuntimeSandbox(
  scopeDir: string,
  runId: string,
): RepoTaskRuntimeSandboxTarget & { projectDir: string } {
  mkdirSync(scopeDir, { recursive: true });
  git(scopeDir, ["init", "-q"]);
  git(scopeDir, ["config", "user.email", "test@test"]);
  git(scopeDir, ["config", "user.name", "test"]);
  git(scopeDir, ["commit", "--allow-empty", "-q", "-m", "initial"]);

  const sandbox = new RunSandboxManager(scopeDir).create({
    runId,
    repository: "write",
  });
  const agentRunDir = join(sandbox.rootDir, "agent");
  mkdirSync(agentRunDir, { recursive: true });
  const store = new RunStateDatabase(join(sandbox.rootDir, "test-state"));
  const context = createRunContext({
    runId,
    attempt: 1,
    daemonEpoch: 1,
    projectId: "test-project",
    projectRoot: scopeDir,
    workflow: "repo-task-mutation",
    trigger: { event: "test.requested", schemaRef: null, payload: {} },
    sandbox,
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir: sandbox.workspaceDir,
      runDir: sandbox.rootDir,
      tempDir: sandbox.tempDir,
      artifactDir: sandbox.artifactDir,
      agentDir: agentRunDir,
      packageCacheDir: join(sandbox.tempDir, "package-cache"),
      ports: { start: 41_000, end: 41_000, size: 1, values: [41_000] },
      env: {},
    },
    signal: new AbortController().signal,
    store,
    now: () => "2026-08-26T00:00:00.000Z",
  });
  store.close();
  const target: RepoTaskRuntimeSandboxTarget & { projectDir: string } = {
    authority: "runtime-owned-sandbox",
    projectDir: sandbox.workspaceDir,
    repositoryAccess: context.repositoryAccess!,
  };
  runtimeTargets.set(resolve(sandbox.workspaceDir), target);
  return target;
}

export function repoTaskRuntimeSandboxTarget(
  projectDir: string,
): RepoTaskRuntimeSandboxTarget {
  const target = runtimeTargets.get(resolve(projectDir));
  if (target === undefined) {
    throw new Error(`No test runtime owns repo-task sandbox "${projectDir}"`);
  }
  return target;
}
