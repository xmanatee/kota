import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROTECTED_CONVERSATION_DIRECTORY } from "#core/tools/protected-scope-paths.js";
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
      for (const path of [workspace, privateRoot]) mkdirSync(path, { recursive: true });
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
      ]) {
        const covering = mounts.filter((mount) =>
          target === mount.target || target.startsWith(`${mount.target}/`)
        );
        expect(covering.at(-1)).toEqual({ kind: "--ro-bind", source, target });
      }
      expect(launch.args.join("\n")).toContain(["--tmpfs", privateRoot, "--remount-ro", privateRoot].join("\n"));
      expect(mounts.filter((mount) => workspace === mount.target).at(-1))
        .toEqual({ kind: "--bind", source: workspace, target: workspace });
    },
  );

  it("masks the physical store once while leaving inaccessible external aliases outside the namespace", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-linux-conversation-alias-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const store = join(root, "store");
    mkdirSync(workspace);
    mkdirSync(store);
    const alias = join(workspace, "sessions");
    symlinkSync(store, alias);
    for (const readableRoots of [[workspace], [workspace, store]]) {
      const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", [], {
        cwd: workspace, authorityConfigPath: join(root, "authority", "config.json"),
        platform: "linux", pathExists: (path) => path === "/usr/bin/bwrap" || existsSync(path),
        readableRoots, readProtectedRoots: [alias, store],
      });
      if (!launch.ok) throw new Error(launch.error);
      const mounts = launch.args.flatMap((arg, index) => arg === "--tmpfs" ? [launch.args[index + 1]] : []);
      expect(mounts).not.toContain(alias);
      expect(mounts.filter((path) => path === store)).toHaveLength(readableRoots.includes(store) ? 1 : 0);
    }
  });

  it.each(["read-only", "writable", "unrestricted"])("masks an absent conversation tree while preserving %s workspace access", (access) => {
    const root = mkdtempSync(join(tmpdir(), "kota-linux-future-conversation-"));
    roots.push(root);
    const workspace = join(root, "packages", "example");
    const canonicalStore = join(root, PROTECTED_CONVERSATION_DIRECTORY);
    for (const path of [workspace, canonicalStore]) mkdirSync(path, { recursive: true });
    writeFileSync(join(canonicalStore, "private.txt"), "private transcript");
    const store = join(workspace, PROTECTED_CONVERSATION_DIRECTORY);
    const ordinary = join(workspace, "ordinary.txt");
    writeFileSync(ordinary, "ordinary");
    const authority = join(root, "authority");
    mkdirSync(authority);
    const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", [], {
      cwd: workspace, authorityConfigPath: join(root, "authority", "config.json"),
      platform: "linux", pathExists: (path) => path === "/usr/bin/bwrap" || existsSync(path),
      readableRoots: access === "unrestricted" ? undefined : [root],
      writableRoots: access === "unrestricted" ? undefined : access === "writable" ? [workspace] : [],
      readProtectedRoots: [canonicalStore, store],
    });
    if (!launch.ok) throw new Error(launch.error);
    const args = launch.args.join("\n");
    if (access === "read-only") {
      expect(args).toContain(["--tmpfs", workspace, ""].join("\n"));
      expect(args).toContain(["--ro-bind", ordinary, ordinary].join("\n"));
    } else {
      // A tmpfs over the workspace loses host writes; per-file binds also
      // prevent atomic replacement even when their contents remain writable.
      expect(args).not.toContain(["--tmpfs", workspace, ""].join("\n"));
      expect(args).not.toContain(["--remount-ro", workspace, ""].join("\n"));
      expect(args).not.toContain(["--bind", ordinary, ordinary].join("\n"));
    }
    expect(args).toContain(["--tmpfs", store, "--remount-ro", store].join("\n"));
    expect(args).toContain(["--tmpfs", canonicalStore, "--remount-ro", canonicalStore].join("\n"));
    expect(args).not.toContain(["--ro-bind", "/dev/null", store].join("\n"));
    expect(existsSync(join(workspace, ".kota"))).toBe(false);
  });

  it("keeps an absent file-mask parent private without projecting its writable workspace ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-linux-absent-state-"));
    roots.push(root);
    const journal = join(root, ".kota", "kota.sqlite-journal");
    const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", [], {
      cwd: root, authorityConfigPath: join(root, "authority", "config.json"),
      platform: "linux", pathExists: (path) => path === "/usr/bin/bwrap" || existsSync(path),
      readableRoots: [root], writableRoots: [root], readProtectedPaths: [journal],
    });
    if (!launch.ok) throw new Error(launch.error);
    const args = launch.args.join("\n");
    expect(args).not.toContain(["--tmpfs", root, ""].join("\n"));
    expect(args).toContain(["--tmpfs", dirname(journal), ""].join("\n"));
    expect(args).toContain(["--ro-bind", "/dev/null", journal].join("\n"));
    expect(args).toContain(["--remount-ro", dirname(journal), ""].join("\n"));
    expect(existsSync(journal)).toBe(false);
  });

  it.runIf(process.platform === "linux").each([false, true])(
    "persists package shell edits and masks existing and future stores (late store: %s)",
    (lateStore) => {
      const root = mkdtempSync(join(tmpdir(), "kota-linux-package-writes-"));
      roots.push(root);
      const cwd = join(root, "packages", "example");
      const canonicalStore = join(root, PROTECTED_CONVERSATION_DIRECTORY);
      const packageStore = join(cwd, PROTECTED_CONVERSATION_DIRECTORY);
      const authority = join(root, "authority");
      for (const path of [cwd, canonicalStore, authority]) mkdirSync(path, { recursive: true });
      writeFileSync(join(canonicalStore, "private.txt"), "canonical private transcript");
      writeFileSync(join(cwd, "replace.txt"), "before");
      writeFileSync(join(cwd, "delete.txt"), "before");
      const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", ["-ec", `
        mkdir new-directory
        printf created > new-directory/new.txt
        printf replaced > replacement.tmp
        mv replacement.tmp replace.txt
        rm delete.txt
        for store do
          if cat "$store/private.txt"; then exit 31; fi
          if printf forbidden > "$store/forbidden.txt"; then exit 32; fi
        done
      `, "sandbox-probe", canonicalStore, packageStore], {
        cwd, authorityConfigPath: join(authority, "config.json"),
        readProtectedRoots: [canonicalStore, packageStore],
      });
      if (!launch.ok) throw new Error(launch.error);
      expect(existsSync(dirname(packageStore))).toBe(false);
      if (lateStore) {
        mkdirSync(packageStore, { recursive: true });
        writeFileSync(join(packageStore, "private.txt"), "late private transcript");
      }
      const result = spawnSync(launch.command, launch.args, { encoding: "utf8" });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain("private transcript");
      expect(readFileSync(join(cwd, "new-directory", "new.txt"), "utf8")).toBe("created");
      expect(readFileSync(join(cwd, "replace.txt"), "utf8")).toBe("replaced");
      expect(existsSync(join(cwd, "delete.txt"))).toBe(false);
      expect(readFileSync(join(canonicalStore, "private.txt"), "utf8")).toBe("canonical private transcript");
      for (const store of [canonicalStore, packageStore]) expect(existsSync(join(store, "forbidden.txt"))).toBe(false);
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
