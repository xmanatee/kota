import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { RunSandboxManager } from "#core/workflow/run-sandbox.js";
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
  scopeRoot: string,
  runId: string,
): RepoTaskRuntimeSandboxTarget {
  mkdirSync(scopeRoot, { recursive: true });
  git(scopeRoot, ["init", "-q"]);
  git(scopeRoot, ["config", "user.email", "test@test"]);
  git(scopeRoot, ["config", "user.name", "test"]);
  git(scopeRoot, ["commit", "--allow-empty", "-q", "-m", "initial"]);

  const sandbox = new RunSandboxManager(scopeRoot).create({
    runId,
    repository: "write",
  });
  const agentRunDir = join(sandbox.rootDir, "agent");
  mkdirSync(agentRunDir, { recursive: true });
  const target: RepoTaskRuntimeSandboxTarget = {
    authority: "runtime-owned-sandbox",
    runId,
    workspaceRoot: sandbox.workspaceDir,
    scopeRoot,
    runtimeResources: {
      profileId: `${runId}:1`,
      agentRunDir,
      tempRoot: sandbox.tempDir,
      artifactRoot: sandbox.artifactDir,
      env: {
        KOTA_WORKSPACE_DIR: sandbox.workspaceDir,
        KOTA_RUN_DIR: agentRunDir,
        KOTA_RUN_TEMP_DIR: sandbox.tempDir,
        KOTA_RUN_ARTIFACT_DIR: sandbox.artifactDir,
      },
    },
  };
  runtimeTargets.set(resolve(sandbox.workspaceDir), target);
  return target;
}

export function repoTaskRuntimeSandboxTarget(
  workspaceRoot: string,
): RepoTaskRuntimeSandboxTarget {
  const target = runtimeTargets.get(resolve(workspaceRoot));
  if (target === undefined) {
    throw new Error(`No test runtime owns repo-task sandbox "${workspaceRoot}"`);
  }
  return target;
}
