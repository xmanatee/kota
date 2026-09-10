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
  it.each(["authority", "protected-path", "write-boundary"] as const)(
    "preserves the %s restriction over an earlier writable descendant during projection",
    (restriction) => {
      const root = mkdtempSync(join(tmpdir(), "kota-linux-write-restriction-"));
      roots.push(root);
      const protectedRoot = join(root, "protected");
      const child = join(protectedRoot, "child");
      const artifacts = restriction === "write-boundary"
        ? join(protectedRoot, "artifacts")
        : join(root, "artifacts");
      for (const path of [child, artifacts]) mkdirSync(path, { recursive: true });
      const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", [], {
        cwd: root,
        authorityConfigPath: join(restriction === "authority" ? protectedRoot : join(root, "authority"), "config.json"),
        platform: "linux",
        pathExists: (path) => path === "/usr/bin/bwrap" || existsSync(path),
        readableRoots: [root],
        writableRoots: [child, artifacts],
        writeProtectedPaths: restriction === "protected-path" ? [protectedRoot] : [],
        writeBoundaries: restriction === "write-boundary"
          ? [{ root: protectedRoot, writableDescendants: [artifacts] }]
          : [],
        // The authority case projects because the operator token is absent.
        readProtectedPaths: restriction === "authority" ? [] : [join(protectedRoot, "absent-secret")],
      });
      expect(launch.ok).toBe(true);
      if (!launch.ok) throw new Error(launch.error);
      expect(launch.args.some((arg, index) =>
        arg === "--tmpfs" && launch.args[index + 1] === protectedRoot
      )).toBe(true);
      const mounts = launch.args.flatMap((arg, index) =>
        arg === "--bind" || arg === "--ro-bind"
          ? [{ kind: arg, target: launch.args[index + 2]! }]
          : []
      );
      for (const [target, kind] of [[child, "--ro-bind"], [artifacts, "--bind"]] as const) {
        expect(mounts.filter((mount) =>
          target === mount.target || target.startsWith(`${mount.target}/`)
        ).at(-1)?.kind).toBe(kind);
      }
    },
  );

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
      for (const path of protectedFiles.slice(0, 3)) writeFileSync(path, "private state");

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
        readSnapshotRoots: [runtimeRoot],
        readProtectedRoots: [privateRoot],
        readProtectedRootMask: mask,
      });
      expect(launch.ok).toBe(true);
      if (!launch.ok) throw new Error(launch.error);
      // This host file did not exist when the policy was compiled. The private
      // directory must still cover it without creating a host-side placeholder.
      expect(existsSync(`${database}-journal`)).toBe(false);
      writeFileSync(`${database}-journal`, "late private journal");
      expect(launch.args).toContain("--tmpfs");
      expect(launch.args.slice(launch.args.indexOf("--tmpfs"), launch.args.indexOf("--tmpfs") + 2))
        .toEqual(["--tmpfs", runtimeRoot]);

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

  it("keeps journal replacement inside a private directory even when every denied file exists", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-linux-journal-replacement-"));
    roots.push(root);
    const journal = join(root, "kota.sqlite-journal");
    writeFileSync(journal, "original journal");
    const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", [], {
      cwd: root,
      authorityConfigPath: join(root, "authority", "config.json"),
      platform: "linux",
      pathExists: (path) => path === "/usr/bin/bwrap" || existsSync(path),
      readableRoots: [root],
      writableRoots: [root],
      readProtectedPaths: [journal],
      readSnapshotRoots: [root],
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) throw new Error(launch.error);
    rmSync(journal);
    const projection = launch.args.indexOf("--tmpfs");
    expect(projection).toBeGreaterThan(-1);
    expect(launch.args[projection + 1]).toBe(root);
    const mask = launch.args.indexOf("/dev/null");
    expect(mask).toBeGreaterThan(projection);
    expect(launch.args[mask + 1]).toBe(journal);
    expect(launch.args.indexOf("--remount-ro")).toBeGreaterThan(mask);
  });
});
