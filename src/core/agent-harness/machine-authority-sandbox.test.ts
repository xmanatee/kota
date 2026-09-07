import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMachineAuthoritySandboxLaunch } from "./machine-authority-sandbox.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Linux machine authority read protection", () => {
  it.each(["readable", "writable", "write-boundary"] as const)(
    "masks protected files and directories exposed by a %s mount",
    (surface) => {
      const root = mkdtempSync(join(tmpdir(), "kota-linux-read-protection-"));
      roots.push(root);
      const runtimeRoot = join(root, "state");
      const workspace = join(runtimeRoot, "runtime", "worktrees", "writer");
      const privateRoot = join(runtimeRoot, "private");
      const mask = join(root, "empty-mask");
      for (const path of [workspace, privateRoot, mask]) mkdirSync(path, { recursive: true });
      const database = join(runtimeRoot, "kota.sqlite");
      const protectedFiles = [database, `${database}-wal`, `${database}-shm`, `${database}-journal`];
      for (const path of protectedFiles) writeFileSync(path, "private state");

      const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", [], {
        cwd: workspace,
        authorityConfigPath: join(root, "authority", "config.json"),
        platform: "linux",
        pathExists: (path) => path === "/usr/bin/bwrap" || existsSync(path),
        readableRoots: surface === "readable" ? [runtimeRoot] : [workspace],
        writableRoots: surface === "writable" ? [runtimeRoot, workspace] : [workspace],
        writeBoundaries: surface === "write-boundary"
          ? [{ root: runtimeRoot, writableDescendants: [workspace] }]
          : [],
        readProtectedPaths: protectedFiles,
        readProtectedRoots: [privateRoot],
        readProtectedRootMask: mask,
      });
      expect(launch.ok).toBe(true);
      if (!launch.ok) throw new Error(launch.error);

      // Bubblewrap applies mounts in order. The final covering mount must hide
      // each protected target even after the runtime and writer mounts reopen.
      const mounts = launch.args.flatMap((arg, index) =>
        arg === "--bind" || arg === "--ro-bind"
          ? [{ kind: arg, source: launch.args[index + 1], target: launch.args[index + 2] }]
          : []
      );
      for (const [target, source] of [
        ...protectedFiles.map((path) => [path, "/dev/null"]),
        [privateRoot, mask],
      ]) {
        const covering = mounts.filter((mount) =>
          target === mount.target || target.startsWith(`${mount.target}/`)
        );
        expect(covering.at(-1)).toEqual({ kind: "--ro-bind", source, target });
      }
      expect(mounts.filter((mount) => workspace === mount.target).at(-1))
        .toEqual({ kind: "--bind", source: workspace, target: workspace });
    },
  );
});
