import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMachineAuthoritySandboxLaunch,
} from "#core/agent-harness/machine-authority-sandbox.js";
import { runShell } from "./shell.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("machine authority execution sandbox", () => {
  it("builds a macOS profile that denies authority writes and token reads", () => {
    const configPath = "/Users/operator/.kota/config.json";
    const launch = buildMachineAuthoritySandboxLaunch("node", ["script.js"], {
      cwd: "/project",
      authorityConfigPath: configPath,
      platform: "darwin",
      pathExists: (path) => path === "/usr/bin/sandbox-exec",
    });

    expect(launch).toMatchObject({
      ok: true,
      command: "/usr/bin/sandbox-exec",
    });
    if (!launch.ok) return;
    expect(launch.args.join("\n")).toContain(
      '(deny file-write* (literal "/Users/operator/.kota") (subpath "/Users/operator/.kota")',
    );
    expect(launch.args.join("\n")).toContain(
      '(deny file-read* (literal "/Users/operator/.kota/scope-authority-token.json")',
    );
    expect(launch.args.slice(-2)).toEqual(["node", "script.js"]);
  });

  it("gives native CLIs bounded workspace writes without exposing Git metadata", () => {
    const launch = buildMachineAuthoritySandboxLaunch("codex", ["exec"], {
      cwd: "/project",
      authorityConfigPath: "/Users/operator/.kota/config.json",
      readableRoots: [
        "/project",
        "/private/tmp/kota-native-cli",
        "/opt/codex",
      ],
      writableRoots: ["/project", "/private/tmp/kota-native-cli"],
      writeProtectedPaths: ["/project/.git"],
      networkAccess: { kind: "loopback-proxy", port: 48_121 },
      platform: "darwin",
      pathExists: (path) => path === "/usr/bin/sandbox-exec",
    });

    expect(launch).toMatchObject({ ok: true });
    if (!launch.ok) return;
    const profile = launch.args[1]!;
    expect(profile).toContain("(deny file-read*)");
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain(
      '(allow network-inbound (local tcp "localhost:*"))',
    );
    expect(profile).toContain(
      '(allow network-outbound (remote tcp "localhost:48121"))',
    );
    expect(profile).toContain('(allow file-read* (literal "/")');
    expect(profile).toContain('(literal "/project")');
    expect(profile).toContain('(literal "/opt/codex")');
    expect(profile).toContain("(deny file-write*)");
    expect(profile).toContain('(allow file-write* (literal "/dev/null")');
    expect(profile).toContain('(literal "/project")');
    expect(profile).toContain('(literal "/private/tmp/kota-native-cli")');
    expect(profile).toContain(
      '(deny file-write* (literal "/Users/operator/.kota")',
    );
    expect(profile).toContain('(literal "/project/.git")');
  });

  it("builds a Linux namespace with the authority directory read-only", () => {
    const configPath = "/operator/.kota/config.json";
    const launch = buildMachineAuthoritySandboxLaunch("python3", ["worker.py"], {
      cwd: "/project",
      authorityConfigPath: configPath,
      platform: "linux",
      pathExists: (path) => path === "/usr/bin/bwrap" || path === dirname(configPath),
    });

    expect(launch).toEqual({
      ok: true,
      command: "/usr/bin/bwrap",
      args: [
        "--die-with-parent",
        "--new-session",
        "--bind",
        "/",
        "/",
        "--ro-bind",
        "/operator/.kota",
        "/operator/.kota",
        "--chdir",
        "/project",
        "--",
        "python3",
        "worker.py",
      ],
    });
  });

  it("mounts only declared native CLI roots writable on Linux", () => {
    const existingPaths = new Set([
      "/usr/bin/bwrap",
      "/operator/.kota",
      "/project",
      "/project/.git",
      "/private/tmp/kota-native-cli",
      "/usr",
      "/opt/codex",
    ]);
    const launch = buildMachineAuthoritySandboxLaunch("codex", ["exec"], {
      cwd: "/project",
      authorityConfigPath: "/operator/.kota/config.json",
      readableRoots: [
        "/usr",
        "/opt/codex",
        "/project",
        "/private/tmp/kota-native-cli",
      ],
      writableRoots: ["/project", "/private/tmp/kota-native-cli"],
      writeProtectedPaths: ["/project/.git"],
      networkAccess: { kind: "offline" },
      platform: "linux",
      pathExists: (path) => existingPaths.has(path),
    });

    expect(launch).toMatchObject({ ok: true });
    if (!launch.ok) return;
    expect(launch.args).not.toEqual(expect.arrayContaining([
      "--ro-bind",
      "/",
      "/",
    ]));
    expect(launch.args).toEqual(expect.arrayContaining([
      "--die-with-parent",
      "--new-session",
      "--unshare-net",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/opt/codex",
      "/opt/codex",
      "--ro-bind",
      "/project",
      "/project",
      "--ro-bind",
      "/private/tmp/kota-native-cli",
      "/private/tmp/kota-native-cli",
      "--bind",
      "/project",
      "/project",
      "--bind",
      "/private/tmp/kota-native-cli",
      "/private/tmp/kota-native-cli",
      "--ro-bind",
      "/project/.git",
      "/project/.git",
    ]));
    expect(launch.args).not.toContain("/operator/.kota");
    expect(launch.args.slice(-5)).toEqual([
      "--chdir",
      "/project",
      "--",
      "codex",
      "exec",
    ]);
  });

  it("hides an existing operator token inside the Linux namespace", () => {
    const configPath = "/operator/.kota/config.json";
    const tokenPath = "/operator/.kota/scope-authority-token.json";
    const launch = buildMachineAuthoritySandboxLaunch("node", ["worker.js"], {
      cwd: "/project",
      authorityConfigPath: configPath,
      platform: "linux",
      pathExists: (path) =>
        path === "/usr/bin/bwrap" ||
        path === dirname(configPath) ||
        path === tokenPath,
    });

    expect(launch).toMatchObject({ ok: true });
    if (!launch.ok) return;
    expect(launch.args).toEqual(expect.arrayContaining([
      "--ro-bind",
      "/dev/null",
      tokenPath,
    ]));
  });

  it("fails closed when the host cannot enforce process isolation", () => {
    expect(buildMachineAuthoritySandboxLaunch("sh", ["-c", "true"], {
      cwd: "/project",
      platform: "win32",
      pathExists: () => false,
    })).toMatchObject({ ok: false, error: expect.stringContaining("unavailable") });
  });

  it("blocks an encoded Node program from rewriting machine authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-authority-sandbox-"));
    roots.push(root);
    const projectDir = join(root, "project");
    const configPath = join(root, "operator", "config.json");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ trustedProjects: [] }), { mode: 0o600 });

    const result = await runShell({
      command:
        "node -e \"require('node:fs').writeFileSync(process.env.TARGET, process.env.PAYLOAD)\"",
      stream_output: false,
    }, {
      cwd: projectDir,
      authorityConfigPath: configPath,
      env: {
        TARGET: configPath,
        PAYLOAD: JSON.stringify({ trustedProjects: [projectDir] }),
      },
    });

    expect(result.is_error).toBe(true);
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ trustedProjects: [] });
  });
});
