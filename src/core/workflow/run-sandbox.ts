import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

export type RepositoryAccess = "none" | "read" | "write";

type RunSandboxBase = {
  runId: string;
  rootDir: string;
  workspaceDir: string;
  tempDir: string;
  artifactDir: string;
};

export type RunSandbox =
  | (RunSandboxBase & {
      repository: "none";
      baseCommit?: undefined;
      branch?: undefined;
    })
  | (RunSandboxBase & {
      repository: "read";
      baseCommit: string;
      branch?: undefined;
    })
  | (RunSandboxBase & {
      repository: "write";
      baseCommit: string;
      branch: string;
      targetBranch: string;
    });

export type RunSandboxCleanup = {
  cleaned: boolean;
  blockers: string[];
};

export type RunSandboxReconciliation =
  | { status: "absent" }
  | { status: "active"; sandbox: RunSandbox }
  | { status: "removed" };

type SandboxPaths = Pick<
  RunSandboxBase,
  "rootDir" | "workspaceDir" | "tempDir" | "artifactDir"
>;

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: withProtectedGitBareRepositoryEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitSucceeds(cwd: string, args: readonly string[]): boolean {
  return (
    spawnSync("git", args, {
      cwd,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "ignore",
    }).status === 0
  );
}

function assertRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
    throw new Error(`Invalid run id "${runId}"`);
  }
}

function allocationName(runId: string): string {
  const slug = runId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const digest = createHash("sha256").update(runId).digest("hex");
  return `${slug}-${digest}`;
}

function comparablePath(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

function assertContained(parent: string, child: string): void {
  const path = relative(comparablePath(parent), comparablePath(child));
  if (
    path === "" ||
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    throw new Error(`Path "${child}" is outside run-owned root "${parent}"`);
  }
}

function assertExactPath(actual: string, expected: string, label: string): void {
  if (resolve(actual) !== resolve(expected)) {
    throw new Error(`${label} must be "${expected}", received "${actual}"`);
  }
}

function repositoryCommonDir(cwd: string): string {
  const commonDir = git(cwd, ["rev-parse", "--git-common-dir"]);
  return comparablePath(isAbsolute(commonDir) ? commonDir : resolve(cwd, commonDir));
}

function repositoryTopLevel(cwd: string): string {
  return comparablePath(git(cwd, ["rev-parse", "--show-toplevel"]));
}

function normalizedCommit(cwd: string, commit: string): string {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(commit)) {
    throw new Error(`Invalid persisted commit "${commit}"`);
  }
  return git(cwd, ["rev-parse", "--verify", `${commit}^{commit}`]);
}

function worktreeCreationCommit(cwd: string): string {
  const entries = git(cwd, ["reflog", "show", "--format=%H%x09%gs", "HEAD"])
    .split("\n")
    .filter(Boolean);
  const creationEntry = entries.at(-1);
  if (creationEntry === undefined || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(creationEntry)) {
    throw new Error(`Cannot prove the creation commit for worktree "${cwd}"`);
  }
  return normalizedCommit(cwd, creationEntry);
}

function activeRebaseBranch(cwd: string): string | undefined {
  for (const statePath of ["rebase-merge/head-name", "rebase-apply/head-name"]) {
    const value = git(cwd, ["rev-parse", "--git-path", statePath]);
    const headName = isAbsolute(value) ? value : resolve(cwd, value);
    if (existsSync(headName)) {
      return readFileSync(headName, "utf8").trim().replace(/^refs\/heads\//, "");
    }
  }
  return undefined;
}

function currentBranch(cwd: string): string {
  const branch = git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch === "") {
    throw new Error(`Repository "${cwd}" must be on a branch for writer runs`);
  }
  return branch;
}

export class RunSandboxManager {
  private readonly projectDir: string;
  private readonly projectCommonDir: string | undefined;
  private readonly worktreesDir: string;
  private readonly runtimeDir: string;

  constructor(projectDir: string) {
    this.projectDir = comparablePath(projectDir);
    this.runtimeDir = join(this.projectDir, ".kota", "runtime");
    this.worktreesDir = join(this.runtimeDir, "worktrees");
    this.projectCommonDir = gitSucceeds(this.projectDir, ["rev-parse", "--git-dir"])
      ? repositoryCommonDir(this.projectDir)
      : undefined;
  }

  create(input: {
    runId: string;
    repository: "none";
  }): Extract<RunSandbox, { repository: "none" }>;
  create(input: {
    runId: string;
    repository: "read";
  }): Extract<RunSandbox, { repository: "read" }>;
  create(input: {
    runId: string;
    repository: "write";
  }): Extract<RunSandbox, { repository: "write" }>;
  create(input: { runId: string; repository: RepositoryAccess }): RunSandbox;
  create(input: { runId: string; repository: RepositoryAccess }): RunSandbox {
    const paths = this.pathsFor(input.runId, input.repository);
    mkdirSync(this.runtimeDir, { recursive: true });
    assertContained(this.projectDir, this.runtimeDir);
    const { artifactDir, rootDir, tempDir, workspaceDir } = paths;
    if (existsSync(rootDir)) {
      throw new Error(`Run sandbox "${input.runId}" already exists`);
    }
    mkdirSync(rootDir);
    mkdirSync(tempDir);
    mkdirSync(artifactDir);

    if (input.repository === "none") {
      mkdirSync(workspaceDir);
      return {
        runId: input.runId,
        repository: input.repository,
        rootDir,
        workspaceDir,
        tempDir,
        artifactDir,
      };
    }

    mkdirSync(this.worktreesDir, { recursive: true });
    assertContained(this.runtimeDir, this.worktreesDir);
    try {
      const baseCommit = this.requireProjectRepository();
      if (input.repository === "read") {
        git(this.projectDir, [
          "worktree",
          "add",
          "--quiet",
          "--detach",
          workspaceDir,
          baseCommit,
        ]);
        return {
          runId: input.runId,
          repository: input.repository,
          rootDir,
          workspaceDir,
          tempDir,
          artifactDir,
          baseCommit,
        };
      }

      const branch = this.branchFor(input.runId);
      const targetBranch = currentBranch(this.projectDir);
      const targetHead = git(this.projectDir, [
        "rev-parse",
        "--verify",
        `refs/heads/${targetBranch}^{commit}`,
      ]);
      if (targetHead !== baseCommit) {
        throw new Error("Canonical branch changed while the writer sandbox was allocated");
      }
      writeFileSync(join(rootDir, "target-branch"), `${targetBranch}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      git(this.projectDir, [
        "worktree",
        "add",
        "--quiet",
        "-b",
        branch,
        workspaceDir,
        baseCommit,
      ]);
      return {
        runId: input.runId,
        repository: input.repository,
        rootDir,
        workspaceDir,
        tempDir,
        artifactDir,
        baseCommit,
        branch,
        targetBranch,
      };
    } catch (error) {
      rmSync(rootDir, { force: true, recursive: true });
      throw error;
    }
  }

  reconcile(runId: string, repository: RepositoryAccess): RunSandboxReconciliation {
    const paths = this.pathsFor(runId, repository);
    const competingWorkspace =
      repository === "none"
        ? join(this.worktreesDir, allocationName(runId))
        : join(paths.rootDir, "workspace");
    if (existsSync(competingWorkspace)) {
      throw new Error(`Cannot reconcile run "${runId}": repository mode is inconsistent`);
    }
    const runtimeExists = [paths.rootDir, paths.tempDir, paths.artifactDir].map((path) =>
      existsSync(path),
    );
    const completeRuntime = runtimeExists.every(Boolean);
    const absentRuntime = runtimeExists.every((exists) => !exists);
    const workspaceExists = existsSync(paths.workspaceDir);
    const branch = this.branchFor(runId);
    const branchExists = gitSucceeds(this.projectDir, [
      "show-ref",
      "--verify",
      `refs/heads/${branch}`,
    ]);

    if (repository !== "write" && branchExists) {
      throw new Error(`Cannot reconcile run "${runId}": repository mode is inconsistent`);
    }

    if (absentRuntime && !workspaceExists && !branchExists) {
      return { status: "absent" };
    }
    if (!completeRuntime && !absentRuntime) {
      throw new Error(`Cannot reconcile run "${runId}": runtime directories are incomplete`);
    }

    if (completeRuntime && workspaceExists) {
      if (repository === "none") {
        const sandbox: RunSandbox = { runId, repository, ...paths };
        return { status: "active", sandbox: this.adopt(sandbox) };
      }

      const baseCommit = worktreeCreationCommit(paths.workspaceDir);
      const sandbox: RunSandbox =
        repository === "read"
          ? { runId, repository, baseCommit, ...paths }
          : {
              runId,
              repository,
              baseCommit,
              branch: this.branchFor(runId),
              targetBranch: this.readTargetBranch(paths.rootDir, runId),
              ...paths,
            };
      return { status: "active", sandbox: this.adopt(sandbox) };
    }

    if (workspaceExists) {
      throw new Error(`Cannot reconcile run "${runId}": runtime root is missing`);
    }

    if (repository === "write" && branchExists) {
      this.requireProjectRepository();
      const targetBranch = this.readTargetBranch(paths.rootDir, runId);
      const branchHead = git(this.projectDir, ["rev-parse", "--verify", `${branch}^{commit}`]);
      const canonicalHead = git(this.projectDir, [
        "rev-parse",
        "--verify",
        `refs/heads/${targetBranch}^{commit}`,
      ]);
      if (
        !gitSucceeds(this.projectDir, [
          "merge-base",
          "--is-ancestor",
          branchHead,
          canonicalHead,
        ])
      ) {
        throw new Error(`Cannot reconcile run "${runId}": writer branch is not integrated`);
      }
      git(this.projectDir, ["branch", "-d", branch]);
      if (completeRuntime) rmSync(paths.rootDir, { recursive: true });
      return { status: "removed" };
    }

    throw new Error(`Cannot reconcile run "${runId}": sandbox state is ambiguous`);
  }

  adopt(sandbox: RunSandbox): RunSandbox {
    this.assertOwnedPaths(sandbox);
    for (const path of [
      sandbox.rootDir,
      sandbox.workspaceDir,
      sandbox.tempDir,
      sandbox.artifactDir,
    ]) {
      if (!existsSync(path)) {
        throw new Error(`Cannot adopt run "${sandbox.runId}": missing ${path}`);
      }
    }
    if (sandbox.repository !== "none") this.verifyRepositorySandbox(sandbox);
    return sandbox;
  }

  cleanup(sandbox: RunSandbox): RunSandboxCleanup {
    this.assertOwnedPaths(sandbox);
    if (sandbox.repository === "none") {
      rmSync(sandbox.rootDir, { recursive: true });
      return { cleaned: true, blockers: [] };
    }

    if (!existsSync(sandbox.workspaceDir)) {
      return { cleaned: false, blockers: ["workspace-missing"] };
    }

    try {
      this.verifyRepositorySandbox(sandbox);
    } catch {
      return { cleaned: false, blockers: ["sandbox-unverified"] };
    }

    if (
      git(sandbox.workspaceDir, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]) !== ""
    ) {
      return { cleaned: false, blockers: ["workspace-dirty"] };
    }

    if (sandbox.repository === "write") {
      const writerHead = git(sandbox.workspaceDir, ["rev-parse", "HEAD"]);
      const canonicalHead = git(this.projectDir, [
        "rev-parse",
        "--verify",
        `refs/heads/${sandbox.targetBranch}^{commit}`,
      ]);
      if (
        !gitSucceeds(this.projectDir, [
          "merge-base",
          "--is-ancestor",
          writerHead,
          canonicalHead,
        ])
      ) {
        return { cleaned: false, blockers: ["commit-not-integrated"] };
      }
    }

    // Git performs a final dirtiness and ownership check while removing the worktree.
    git(this.projectDir, ["worktree", "remove", sandbox.workspaceDir]);
    if (sandbox.repository === "write") {
      git(this.projectDir, ["branch", "-d", sandbox.branch]);
    }
    rmSync(sandbox.rootDir, { recursive: true });
    return { cleaned: true, blockers: [] };
  }

  private requireProjectRepository(): string {
    if (this.projectCommonDir === undefined) {
      throw new Error(`Project "${this.projectDir}" is not a Git repository`);
    }
    if (repositoryTopLevel(this.projectDir) !== this.projectDir) {
      throw new Error(`Project "${this.projectDir}" is not the repository root`);
    }
    if (repositoryCommonDir(this.projectDir) !== this.projectCommonDir) {
      throw new Error(`Project "${this.projectDir}" repository identity changed`);
    }
    return git(this.projectDir, ["rev-parse", "--verify", "HEAD^{commit}"]);
  }

  private verifyRepositorySandbox(
    sandbox: Extract<RunSandbox, { repository: "read" | "write" }>,
  ): void {
    this.requireProjectRepository();
    if (repositoryCommonDir(sandbox.workspaceDir) !== this.projectCommonDir) {
      throw new Error(`Run "${sandbox.runId}" belongs to another repository`);
    }
    if (repositoryTopLevel(sandbox.workspaceDir) !== comparablePath(sandbox.workspaceDir)) {
      throw new Error(`Run "${sandbox.runId}" workspace is not a worktree root`);
    }

    const baseCommit = normalizedCommit(sandbox.workspaceDir, sandbox.baseCommit);
    if (baseCommit !== sandbox.baseCommit) {
      throw new Error(`Run "${sandbox.runId}" has a non-canonical base commit`);
    }
    const headCommit = git(sandbox.workspaceDir, ["rev-parse", "--verify", "HEAD^{commit}"]);

    if (sandbox.repository === "read") {
      if (gitSucceeds(sandbox.workspaceDir, ["symbolic-ref", "-q", "HEAD"])) {
        throw new Error(`Reader sandbox "${sandbox.runId}" is not detached`);
      }
      if (headCommit !== baseCommit) {
        throw new Error(`Reader sandbox "${sandbox.runId}" moved from its base commit`);
      }
      return;
    }

    const expectedBranch = this.branchFor(sandbox.runId);
    if (sandbox.branch !== expectedBranch) {
      throw new Error(`Writer sandbox "${sandbox.runId}" has an unexpected branch`);
    }
    if (this.readTargetBranch(sandbox.rootDir, sandbox.runId) !== sandbox.targetBranch) {
      throw new Error(`Writer sandbox "${sandbox.runId}" has an unexpected target branch`);
    }
    const branchHead = git(sandbox.workspaceDir, [
      "rev-parse",
      "--verify",
      `${expectedBranch}^{commit}`,
    ]);
    if (
      !gitSucceeds(sandbox.workspaceDir, [
        "merge-base",
        "--is-ancestor",
        baseCommit,
        branchHead,
      ])
    ) {
      throw new Error(`Writer sandbox "${sandbox.runId}" branch is outside its base lineage`);
    }
    const currentBranch = git(sandbox.workspaceDir, ["branch", "--show-current"]);
    if (
      currentBranch !== expectedBranch &&
      activeRebaseBranch(sandbox.workspaceDir) !== expectedBranch
    ) {
      throw new Error(`Writer sandbox "${sandbox.runId}" is not on its owned branch`);
    }
    if (
      !gitSucceeds(sandbox.workspaceDir, [
        "merge-base",
        "--is-ancestor",
        baseCommit,
        headCommit,
      ])
    ) {
      throw new Error(`Writer sandbox "${sandbox.runId}" head is outside its base lineage`);
    }
  }

  private branchFor(runId: string): string {
    return `kota/run/${allocationName(runId)}`;
  }

  private readTargetBranch(rootDir: string, runId: string): string {
    const path = join(rootDir, "target-branch");
    if (!existsSync(path)) {
      throw new Error(`Cannot reconcile writer run "${runId}": target branch is missing`);
    }
    const branch = readFileSync(path, "utf8").trim();
    if (
      branch === "" ||
      !gitSucceeds(this.projectDir, ["check-ref-format", "--branch", branch])
    ) {
      throw new Error(`Cannot reconcile writer run "${runId}": target branch is invalid`);
    }
    return branch;
  }

  private pathsFor(runId: string, repository: RepositoryAccess): SandboxPaths {
    assertRunId(runId);
    const allocation = allocationName(runId);
    const rootDir = join(this.runtimeDir, allocation);
    const paths = {
      rootDir,
      tempDir: join(rootDir, "tmp"),
      artifactDir: join(rootDir, "artifacts"),
      workspaceDir:
        repository === "none"
          ? join(rootDir, "workspace")
          : join(this.worktreesDir, allocation),
    };

    assertContained(this.projectDir, this.runtimeDir);
    assertContained(this.runtimeDir, paths.rootDir);
    assertContained(paths.rootDir, paths.tempDir);
    assertContained(paths.rootDir, paths.artifactDir);
    if (repository !== "none") {
      assertContained(this.runtimeDir, this.worktreesDir);
    }
    assertContained(
      repository === "none" ? paths.rootDir : this.worktreesDir,
      paths.workspaceDir,
    );
    return paths;
  }

  private assertOwnedPaths(sandbox: RunSandbox): void {
    const expected = this.pathsFor(sandbox.runId, sandbox.repository);

    assertExactPath(sandbox.rootDir, expected.rootDir, "Run root");
    assertExactPath(sandbox.tempDir, expected.tempDir, "Run temp directory");
    assertExactPath(
      sandbox.artifactDir,
      expected.artifactDir,
      "Run artifact directory",
    );
    assertExactPath(sandbox.workspaceDir, expected.workspaceDir, "Run workspace");
  }
}
