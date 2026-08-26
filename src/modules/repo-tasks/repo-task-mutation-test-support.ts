import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { createRunContext } from "#core/workflow/run-context.js";
import { RunSandboxManager } from "#core/workflow/run-sandbox.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { RepoTaskRuntimeSandboxTarget } from "./repo-task-mutation-boundary.js";

const runtimeTargets = new Map<string, RepoTaskRuntimeSandboxTarget>();
const runtimeStores = new Map<
  string,
  { store: RunStateDatabase; runId: string; epoch: number }
>();

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
): RepoTaskRuntimeSandboxTarget & { workspaceRoot: string } {
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
  const store = new RunStateDatabase(join(sandbox.rootDir, "test-state"));
  const startedAt = "2026-08-26T00:00:00.000Z";
  store.registerScope({
    id: "test-scope",
    rootPath: scopeRoot,
    createdAt: startedAt,
  });
  const { epoch } = store.beginDaemonSession(startedAt);
  store.admitRun({
    id: runId,
    scopeId: "test-scope",
    workflow: "repo-task-mutation",
    repository: "write",
    trigger: { event: "test.requested", schemaRef: null, payload: {} },
    resources: [],
    admittedAt: startedAt,
  });
  const attempt = store.startRun(runId, epoch, startedAt);
  if (attempt === null) throw new Error(`Unable to start test run "${runId}"`);
  store.setSandbox(runId, epoch, sandbox);
  const context = createRunContext({
    runId,
    attempt,
    daemonEpoch: epoch,
    scopeId: "test-scope",
    scopeRoot,
    workflow: "repo-task-mutation",
    trigger: { event: "test.requested", schemaRef: null, payload: {} },
    sandbox,
    resources: {
      runId,
      attempt,
      daemonEpoch: epoch,
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
  const target: RepoTaskRuntimeSandboxTarget & { workspaceRoot: string } = {
    authority: "runtime-owned-sandbox",
    workspaceRoot: sandbox.workspaceDir,
    repositoryAccess: context.repositoryAccess!,
  };
  runtimeTargets.set(resolve(sandbox.workspaceDir), target);
  runtimeStores.set(resolve(sandbox.workspaceDir), { store, runId, epoch });
  return target;
}

export function finishRepoTaskRuntimeSandbox(workspaceRoot: string): void {
  const runtime = runtimeStores.get(resolve(workspaceRoot));
  if (runtime === undefined) throw new Error(`No test runtime owns "${workspaceRoot}"`);
  runtime.store.finishRun(
    runtime.runId,
    runtime.epoch,
    "succeeded",
    "2026-08-26T00:01:00.000Z",
  );
}

export function disposeRepoTaskRuntimeSandboxes(): void {
  for (const runtime of runtimeStores.values()) runtime.store.close();
  runtimeStores.clear();
  runtimeTargets.clear();
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
