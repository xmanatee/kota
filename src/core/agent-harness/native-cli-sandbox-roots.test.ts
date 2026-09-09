import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  nativeCliGitMetadataRoots,
  nativeCliReadableRoots,
  resolveNativeCliExecutable,
} from "./native-cli-sandbox-roots.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("native CLI sandbox roots", () => {
  it("keeps inherited dependencies readable when a workspace has a local dependency directory", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-dependencies-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const dependency = join(root, "node_modules", "inherited-package");
    mkdirSync(join(workspace, "node_modules"), { recursive: true });
    mkdirSync(dependency, { recursive: true });
    writeFileSync(join(dependency, "index.js"), "module.exports = 42;");
    const resolved = createRequire(join(workspace, "entry.js")).resolve("inherited-package");
    const readable = nativeCliReadableRoots(process.execPath, workspace, workspace, {});

    expect(readable.some((path) => resolved.startsWith(`${path}/`))).toBe(true);
    expect(readable).not.toContain(realpathSync.native(root));
  });

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
