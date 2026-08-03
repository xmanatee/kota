import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMachineAuthoritySandboxLaunch } from "#core/agent-harness/machine-authority-sandbox.js";
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
