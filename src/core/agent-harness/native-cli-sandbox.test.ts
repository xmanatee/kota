import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildNativeCliEnvironment } from "./native-cli-environment.js";
import {
  isNativeCliSandboxBootstrapError,
  type NativeCliSandboxProcess,
  withNativeCliSandbox,
} from "./native-cli-sandbox.js";

const roots: string[] = [];

type NativeProcessResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runNativeProcess(
  cwd: string,
  process: NativeCliSandboxProcess,
): Promise<NativeProcessResult> {
  return await new Promise<NativeProcessResult>((resolve, reject) => {
    const child = spawn(process.command, process.args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdin.end();
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({
      status,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

describe("native CLI live sandbox", () => {
  it("projects linked-worktree Git directories into the write-protected boundary", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-git-boundary-"));
    roots.push(root);
    const projectDir = join(root, "project");
    const worktreeDir = join(root, "linked");
    mkdirSync(projectDir);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectDir });
    execFileSync("git", ["config", "user.name", "test"], { cwd: projectDir });
    writeFileSync(join(projectDir, "tracked.txt"), "tracked\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: projectDir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: projectDir });
    execFileSync("git", ["worktree", "add", "-q", "-b", "linked", worktreeDir], {
      cwd: projectDir,
    });
    let protectedPaths: readonly string[] = [];

    await withNativeCliSandbox(
      "/bin/sh",
      ["-c", "true"],
      {
        cwd: worktreeDir,
        machineAuthorityOwner: "native-cli",
        writableRoots: [join(worktreeDir, "tracked.txt")],
        env: buildNativeCliEnvironment(),
        prepareEnvironment: (context, env) => {
          protectedPaths = context.writeProtectedPaths;
          return env;
        },
      },
      async () => undefined,
    );

    expect(protectedPaths).toEqual(expect.arrayContaining([
      join(worktreeDir, ".git"),
      realpathSync.native(join(projectDir, ".git", "worktrees", "linked")),
      realpathSync.native(join(projectDir, ".git")),
    ]));
  });

  it.runIf(process.platform === "darwin")(
    "denies host-file reads outside declared roots",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "kota-native-read-sandbox-"));
      roots.push(root);
      const projectDir = join(root, "project");
      const outsidePath = join(root, "operator-credential.txt");
      const insidePath = join(projectDir, "project.txt");
      mkdirSync(projectDir);
      writeFileSync(insidePath, "project-visible\n");
      writeFileSync(outsidePath, "host-secret\n");

      const result = await withNativeCliSandbox(
        "/bin/sh",
        [
          "-c",
          [
            'IFS= read -r inside < "$INSIDE_PATH" || exit 20',
            'printf \'{"inside":"%s","home":"%s"}\\n\' "$inside" "$HOME"',
            'IFS= read -r outside < "$OUTSIDE_PATH"',
          ].join("; "),
        ],
        {
          cwd: projectDir,
          machineAuthorityOwner: "kota",
          writableRoots: [],
          env: buildNativeCliEnvironment({
            overrides: { INSIDE_PATH: insidePath, OUTSIDE_PATH: outsidePath },
          }),
        },
        (sandboxedProcess) => runNativeProcess(projectDir, sandboxedProcess),
      );

      expect(result.status).not.toBe(0);
      if (isNativeCliSandboxBootstrapError(result.stderr)) {
        expect(result.stdout).toBe("");
        return;
      }
      expect(result.signal).not.toBe("SIGABRT");
      const firstLine = result.stdout.trim().split("\n")[0];
      expect(
        firstLine,
        `native sandbox status=${result.status} signal=${result.signal ?? "none"} stderr: ${result.stderr}`,
      ).not.toBe("");
      expect(JSON.parse(firstLine)).toMatchObject({
        inside: "project-visible",
        home: expect.stringContaining("kota-native-cli-"),
      });
      expect(result.stderr).toMatch(/operation not permitted/i);
    },
  );

  it.runIf(process.platform === "darwin")(
    "denies project credential reads inside an otherwise readable workspace",
    async () => {
      const projectDir = mkdtempSync(join(tmpdir(), "kota-native-secret-sandbox-"));
      roots.push(projectDir);
      const secretPath = join(projectDir, ".env");
      writeFileSync(secretPath, "TOKEN=project-secret\n");

      const result = await withNativeCliSandbox(
        "/bin/sh",
        ["-c", 'cat "$TARGET"'],
        {
          cwd: projectDir,
          machineAuthorityOwner: "kota",
          writableRoots: [projectDir],
          env: buildNativeCliEnvironment({
            overrides: { TARGET: secretPath },
          }),
        },
        (sandboxedProcess) => runNativeProcess(projectDir, sandboxedProcess),
      );

      if (isNativeCliSandboxBootstrapError(result.stderr)) {
        expect(result.stdout).toBe("");
        return;
      }
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/operation not permitted/i);
    },
  );

  it.runIf(process.platform === "darwin")(
    "hides executable workspace configuration roots",
    async () => {
      const projectDir = mkdtempSync(join(tmpdir(), "kota-native-config-sandbox-"));
      roots.push(projectDir);
      const configurationRoot = join(projectDir, ".gemini");
      const settingsPath = join(configurationRoot, "settings.json");
      mkdirSync(configurationRoot);
      writeFileSync(settingsPath, JSON.stringify({
        mcpServers: { hostile: { command: "read-provider-auth" } },
      }));

      const result = await withNativeCliSandbox(
        "/bin/sh",
        ["-c", 'cat "$TARGET"'],
        {
          cwd: projectDir,
          machineAuthorityOwner: "kota",
          writableRoots: [projectDir],
          readProtectedRoots: [configurationRoot],
          env: buildNativeCliEnvironment({
            overrides: { TARGET: settingsPath },
          }),
        },
        (sandboxedProcess) => runNativeProcess(projectDir, sandboxedProcess),
      );

      if (isNativeCliSandboxBootstrapError(result.stderr)) {
        expect(result.stdout).toBe("");
        return;
      }
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/operation not permitted/i);
    },
  );

  it.runIf(process.platform === "darwin")(
    "permits only mediated provider-proxy traffic and denies direct loopback",
    async () => {
      const listener = createServer();
      await new Promise<void>((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = listener.address();
        if (address === null || typeof address === "string") {
          throw new Error("loopback regression listener did not bind to TCP");
        }
        const projectDir = mkdtempSync(join(tmpdir(), "kota-native-egress-sandbox-"));
        roots.push(projectDir);
        const script = [
          'const { connect } = require("node:net")',
          'const proxy = new URL(process.env.HTTPS_PROXY)',
          'const mediated = connect({ host: proxy.hostname, port: Number(proxy.port) })',
          'let response = ""',
          'mediated.once("connect", () => mediated.write("CONNECT attacker.example:443 HTTP/1.1\\r\\nHost: attacker.example:443\\r\\n\\r\\n"))',
          'mediated.on("data", (chunk) => { response += chunk })',
          'mediated.once("end", () => {',
          '  if (!response.startsWith("HTTP/1.1 403 Forbidden")) process.exit(22)',
          '  const direct = connect({ host: "127.0.0.1", port: Number(process.env.TARGET_PORT) })',
          '  direct.once("connect", () => process.exit(20))',
          '  direct.once("error", () => process.exit(0))',
          '})',
          'mediated.once("error", () => process.exit(23))',
          'setTimeout(() => process.exit(21), 2000)',
        ].join("; ");
        const result = await withNativeCliSandbox(
          process.execPath,
          ["-e", script],
          {
            cwd: projectDir,
            machineAuthorityOwner: "kota",
            writableRoots: [],
            env: buildNativeCliEnvironment({
              overrides: { TARGET_PORT: String(address.port) },
            }),
            allowedEgressHosts: ["chatgpt.com"],
          },
          (sandboxedProcess) => runNativeProcess(projectDir, sandboxedProcess),
        );

        if (isNativeCliSandboxBootstrapError(result.stderr)) {
          expect(result.stdout).toBe("");
          return;
        }
        expect(result.signal).not.toBe("SIGABRT");
        expect(
          result.status,
          `native egress status=${result.status} signal=${result.signal ?? "none"} stderr: ${result.stderr}`,
        ).toBe(0);
      } finally {
        await new Promise<void>((resolve, reject) => {
          listener.close((error) => error === undefined ? resolve() : reject(error));
        });
      }
    },
  );

  it("lets a native CLI own the sandbox without an outer wrapper", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-native-owned-sandbox-"));
    roots.push(projectDir);

    const process = await withNativeCliSandbox(
      "/bin/sh",
      ["-c", "true"],
      {
        cwd: projectDir,
        machineAuthorityOwner: "native-cli",
        writableRoots: [projectDir],
        env: buildNativeCliEnvironment(),
      },
      async (sandboxedProcess) => sandboxedProcess,
    );

    expect(process.command).toBe("/bin/sh");
    expect(process.args).toEqual(["-c", "true"]);
    expect(process.env.HOME).toContain("kota-native-cli-");
  });
});
