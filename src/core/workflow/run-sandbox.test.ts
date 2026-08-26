import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { type RunSandbox, RunSandboxManager } from "./run-sandbox.js";

const roots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitSucceeds(cwd: string, ...args: string[]): boolean {
  return spawnSync("git", args, { cwd, encoding: "utf8" }).status === 0;
}

function configureRepository(root: string): void {
  git(root, "config", "user.name", "KOTA Test");
  git(root, "config", "user.email", "kota@example.test");
  writeFileSync(join(root, ".gitignore"), ".kota/\n");
  writeFileSync(join(root, "value.txt"), "canonical\n");
  git(root, "add", ".gitignore", "value.txt");
  git(root, "commit", "-m", "initial");
}

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "kota-sandbox-"));
  roots.push(root);
  git(root, "init", "-b", "main");
  configureRepository(root);
  return root;
}

function commitValue(workspaceDir: string, value: string): string {
  writeFileSync(join(workspaceDir, "value.txt"), `${value}\n`);
  git(workspaceDir, "add", "value.txt");
  git(workspaceDir, "commit", "-m", value);
  return git(workspaceDir, "rev-parse", "HEAD");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("RunSandboxManager", () => {
  test("allocates every repository access mode in a run-owned isolated location", () => {
    const projectDir = createRepository();
    const manager = new RunSandboxManager(projectDir);
    const repositoryFree = manager.create({ runId: "plain", repository: "none" });
    const reader = manager.create({ runId: "reader", repository: "read" });
    const dotted = manager.create({ runId: "same.name", repository: "write" });
    const dashed = manager.create({ runId: "same-name", repository: "write" });

    expect(repositoryFree.workspaceDir).toContain(join(".kota", "runtime"));
    expect(gitSucceeds(reader.workspaceDir, "symbolic-ref", "-q", "HEAD")).toBe(false);
    expect(dotted.workspaceDir).not.toBe(dashed.workspaceDir);
    expect(dotted.branch).not.toBe(dashed.branch);
    expect(dotted.targetBranch).toBe("main");
    expect(basename(dotted.workspaceDir)).toMatch(/^same-name-[0-9a-f]{64}$/);
    expect(readFileSync(join(projectDir, "value.txt"), "utf8")).toBe("canonical\n");
    expect(git(projectDir, "status", "--porcelain=v1", "--untracked-files=all")).toBe("");
  });

  test("reconciles crash-window sandboxes from Git facts and finishes proven cleanup", () => {
    const projectDir = createRepository();
    const manager = new RunSandboxManager(projectDir);

    expect(manager.reconcile("active", "write")).toEqual({ status: "absent" });

    const active = manager.create({ runId: "active", repository: "write" });
    const activeHead = commitValue(active.workspaceDir, "active change");
    git(projectDir, "merge", "--ff-only", activeHead);
    expect(new RunSandboxManager(projectDir).reconcile("active", "write")).toEqual({
      status: "active",
      sandbox: active,
    });

    const reader = manager.create({ runId: "reader-crash", repository: "read" });
    const removed = manager.create({ runId: "removed", repository: "write" });
    const removedHead = commitValue(removed.workspaceDir, "removed change");
    git(projectDir, "merge", "--ff-only", removedHead);
    git(projectDir, "worktree", "remove", removed.workspaceDir);
    expect(new RunSandboxManager(projectDir).reconcile("removed", "write")).toEqual({
      status: "removed",
    });
    expect(existsSync(removed.rootDir)).toBe(false);
    expect(gitSucceeds(projectDir, "show-ref", "--verify", `refs/heads/${removed.branch}`)).toBe(
      false,
    );

    git(reader.workspaceDir, "checkout", "--detach", removedHead);
    expect(() => manager.reconcile("reader-crash", "read")).toThrow(
      /moved from its base commit/,
    );

    const unintegrated = manager.create({ runId: "orphan", repository: "write" });
    commitValue(unintegrated.workspaceDir, "orphan change");
    git(projectDir, "worktree", "remove", unintegrated.workspaceDir);
    expect(() => manager.reconcile("orphan", "write")).toThrow(/not integrated/);
    expect(existsSync(unintegrated.rootDir)).toBe(true);

    const ambiguous = manager.create({ runId: "ambiguous", repository: "none" });
    rmSync(ambiguous.workspaceDir, { recursive: true });
    expect(() => manager.reconcile("ambiguous", "none")).toThrow(/ambiguous/);
    expect(existsSync(ambiguous.rootDir)).toBe(true);
  });

  test("adopts only the persisted sandbox belonging to the expected repository and lineage", () => {
    const projectDir = createRepository();
    const manager = new RunSandboxManager(projectDir);
    const valid = manager.create({ runId: "valid", repository: "write" });
    expect(new RunSandboxManager(projectDir).adopt(valid)).toEqual(valid);

    const reader = manager.create({ runId: "moved-reader", repository: "read" });
    const newerCanonical = commitValue(projectDir, "new canonical");
    git(reader.workspaceDir, "checkout", "--detach", newerCanonical);
    expect(() => manager.adopt(reader)).toThrow(/moved from its base commit/);

    const forgedBase = { ...valid, baseCommit: newerCanonical };
    expect(() => manager.adopt(forgedBase)).toThrow(/outside its base lineage/);

    const rebasing = manager.create({ runId: "rebasing", repository: "write" });
    commitValue(rebasing.workspaceDir, "branch conflict");
    commitValue(projectDir, "canonical conflict");
    expect(gitSucceeds(rebasing.workspaceDir, "rebase", "main")).toBe(false);
    expect(new RunSandboxManager(projectDir).adopt(rebasing)).toEqual(rebasing);

    git(projectDir, "worktree", "remove", valid.workspaceDir);
    mkdirSync(valid.workspaceDir);
    git(valid.workspaceDir, "init", "-b", valid.branch);
    configureRepository(valid.workspaceDir);
    expect(() => manager.adopt(valid)).toThrow(/another repository/);
  });

  test("preserves dirty, unintegrated, and unverifiable repository work", () => {
    const projectDir = createRepository();
    const manager = new RunSandboxManager(projectDir);
    const dirty = manager.create({ runId: "dirty", repository: "write" });
    writeFileSync(join(dirty.workspaceDir, "value.txt"), "dirty\n");
    expect(manager.cleanup(dirty)).toEqual({
      cleaned: false,
      blockers: ["workspace-dirty"],
    });

    const unintegrated = manager.create({ runId: "unintegrated", repository: "write" });
    commitValue(unintegrated.workspaceDir, "unintegrated");
    expect(manager.cleanup(unintegrated)).toEqual({
      cleaned: false,
      blockers: ["commit-not-integrated"],
    });

    const reader = manager.create({ runId: "reader", repository: "read" });
    git(reader.workspaceDir, "checkout", "--detach", unintegrated.baseCommit);
    const unverified = { ...reader, baseCommit: "0".repeat(40) };
    expect(manager.cleanup(unverified)).toEqual({
      cleaned: false,
      blockers: ["sandbox-unverified"],
    });
    expect(existsSync(dirty.workspaceDir)).toBe(true);
    expect(existsSync(unintegrated.workspaceDir)).toBe(true);
    expect(existsSync(reader.workspaceDir)).toBe(true);
  });

  test("removes only repository work proven safe and integrated", () => {
    const projectDir = createRepository();
    const manager = new RunSandboxManager(projectDir);
    const repositoryFree = manager.create({ runId: "plain", repository: "none" });
    const reader = manager.create({ runId: "reader", repository: "read" });
    const writer = manager.create({ runId: "writer", repository: "write" });
    const writerHead = commitValue(writer.workspaceDir, "integrated");
    git(projectDir, "merge", "--ff-only", writerHead);

    expect(manager.cleanup(repositoryFree)).toEqual({ cleaned: true, blockers: [] });
    expect(manager.cleanup(reader)).toEqual({ cleaned: true, blockers: [] });
    expect(manager.cleanup(writer)).toEqual({ cleaned: true, blockers: [] });
    expect(existsSync(repositoryFree.rootDir)).toBe(false);
    expect(existsSync(reader.workspaceDir)).toBe(false);
    expect(existsSync(writer.workspaceDir)).toBe(false);
    expect(gitSucceeds(projectDir, "show-ref", "--verify", `refs/heads/${writer.branch}`)).toBe(
      false,
    );
  });

  test("keeps the writer bound to its original target branch across branch switches", () => {
    const projectDir = createRepository();
    const manager = new RunSandboxManager(projectDir);
    const writer = manager.create({ runId: "writer-target", repository: "write" });
    const writerHead = commitValue(writer.workspaceDir, "integrated on main");
    git(projectDir, "merge", "--ff-only", writerHead);
    git(projectDir, "switch", "-c", "owner-work");

    expect(new RunSandboxManager(projectDir).adopt(writer)).toEqual(writer);
    expect(manager.cleanup(writer)).toEqual({ cleaned: true, blockers: [] });
    expect(git(projectDir, "branch", "--show-current")).toBe("owner-work");
  });

  test("refuses persisted paths that escape or impersonate another run allocation", () => {
    const projectDir = createRepository();
    const manager = new RunSandboxManager(projectDir);
    const sandbox = manager.create({ runId: "owned", repository: "none" });
    const other = manager.create({ runId: "other", repository: "none" });

    expect(() =>
      manager.adopt({ ...sandbox, workspaceDir: other.workspaceDir }),
    ).toThrow(/Run workspace must be/);

    const externalRoot = mkdtempSync(join(tmpdir(), "kota-sandbox-external-"));
    roots.push(externalRoot);
    writeFileSync(join(externalRoot, "keep.txt"), "preserve\n");
    rmSync(sandbox.rootDir, { recursive: true });
    symlinkSync(externalRoot, sandbox.rootDir, "dir");

    expect(() => manager.cleanup(sandbox as RunSandbox)).toThrow(/outside run-owned root/);
    expect(readFileSync(join(externalRoot, "keep.txt"), "utf8")).toBe("preserve\n");
  });
});
