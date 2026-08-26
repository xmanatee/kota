import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  nativeCliGitMetadataRoots,
  nativeCliReadableRoots,
  nativeCliWorkspaceConfigurationReadRoots,
  resolveNativeCliExecutable,
} from "./native-cli-sandbox-roots.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("native CLI sandbox roots", () => {
  it("resolves a PATH executable through its real identity", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-executable-root-"));
    roots.push(root);
    const installDirectory = join(root, "install");
    const binDirectory = join(root, "bin");
    const executable = join(installDirectory, "native-cli");
    mkdirSync(installDirectory);
    mkdirSync(binDirectory);
    writeFileSync(executable, "binary");
    symlinkSync(executable, join(binDirectory, "native-cli"));

    expect(resolveNativeCliExecutable("native-cli", { PATH: binDirectory }))
      .toBe(realpathSync.native(executable));
  });

  it("does not widen an arbitrary operator bin directory to the operator home", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-readable-roots-"));
    roots.push(root);
    const operatorHome = join(root, "operator");
    const operatorBin = join(operatorHome, "bin");
    const nvmRoot = join(
      operatorHome,
      ".nvm",
      "versions",
      "node",
      "v22.0.0",
    );
    const nvmBin = join(nvmRoot, "bin");
    const scopeRoot = join(root, "project");
    const invocationRoot = join(root, "invocation");
    mkdirSync(operatorBin, { recursive: true });
    mkdirSync(nvmBin, { recursive: true });
    mkdirSync(scopeRoot);
    mkdirSync(invocationRoot);

    const readableRoots = nativeCliReadableRoots(
      join(operatorBin, "native-cli"),
      scopeRoot,
      invocationRoot,
      { PATH: [operatorHome, operatorBin, nvmBin].join(":") },
      "linux",
    );

    expect(readableRoots).toContain(operatorBin);
    expect(readableRoots).toContain(nvmRoot);
    expect(readableRoots).not.toContain(operatorHome);
  });

  it("resolves declared workspace configuration through physical symlink targets", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-config-root-"));
    roots.push(root);
    const scopeRoot = join(root, "project");
    const sharedConfigDir = join(root, "shared-config");
    mkdirSync(scopeRoot);
    mkdirSync(sharedConfigDir);
    writeFileSync(join(sharedConfigDir, "settings.json"), "{}");
    symlinkSync(sharedConfigDir, join(scopeRoot, ".client"));

    expect(nativeCliWorkspaceConfigurationReadRoots(scopeRoot, [
      ".client/settings.json",
      ".client/missing.json",
    ])).toEqual([
      realpathSync.native(join(sharedConfigDir, "settings.json")),
    ]);
  });

  it("exposes linked-worktree Git metadata as read-only roots", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-git-roots-"));
    roots.push(root);
    const scopeRoot = join(root, "project");
    const worktreeDir = join(root, "linked");
    mkdirSync(scopeRoot);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: scopeRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: scopeRoot,
    });
    execFileSync("git", ["config", "user.name", "test"], { cwd: scopeRoot });
    writeFileSync(join(scopeRoot, "tracked.txt"), "tracked\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: scopeRoot });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: scopeRoot });
    execFileSync("git", ["worktree", "add", "-q", "-b", "linked", worktreeDir], {
      cwd: scopeRoot,
    });

    expect(nativeCliGitMetadataRoots(worktreeDir)).toEqual([
      realpathSync.native(join(scopeRoot, ".git", "worktrees", "linked")),
      realpathSync.native(join(scopeRoot, ".git")),
    ]);
  });
});
