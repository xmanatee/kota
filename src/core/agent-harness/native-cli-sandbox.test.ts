import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
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
  it.each(["canonical", "custom-linked"])(
    "protects host database locators for a non-writer with %s state storage",
    async (storage) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "kota-native-database-")));
      roots.push(root);
      const cwd = join(root, "project");
      mkdirSync(cwd);
      const stateDir = storage === "canonical" ? join(cwd, ".kota") : join(root, "state-link");
      const actualStateDir = storage === "canonical" ? stateDir : join(root, "private-state");
      mkdirSync(actualStateDir);
      if (storage !== "canonical") symlinkSync(actualStateDir, stateDir);
      const store = new RunStateDatabase(stateDir);
      const reader = RunStateDatabase.openReadOnly(stateDir);
      store.close();
      try {
        await withNativeCliSandbox("/bin/sh", [], {
          cwd,
          machineAuthorityOwner: "native-cli",
          writableRoots: [cwd],
          readOnlyHostRoots: [root],
          env: buildNativeCliEnvironment(),
          prepareEnvironment(context, env) {
            expect(env.KOTA_RUN_ID).toBeUndefined();
            expect(env.KOTA_RUN_AUTHORIZATION).toBeUndefined();
            expect(context.readableRoots).toContain(cwd);
            // Closing a second connection cannot remove the live host's denials.
            for (const directory of [stateDir, actualStateDir]) {
              for (const suffix of ["", "-wal", "-shm", "-journal"]) {
                expect(context.readProtectedPaths).toContain(join(directory, `kota.sqlite${suffix}`));
              }
            }
            return env;
          },
        }, async () => undefined);
      } finally {
        reader.close();
      }
      expect(RunStateDatabase.readProtectedPaths()).not.toContain(join(actualStateDir, "kota.sqlite"));
    },
  );

  it.runIf(process.platform === "darwin" || process.platform === "linux")(
    "launches from a read-only repository without a state directory and retains artifact access",
    async ({ skip }) => {
      const cwd = realpathSync(mkdtempSync(join(tmpdir(), "kota-native-offline-state-")));
      roots.push(cwd);
      const artifacts = join(cwd, "artifacts");
      mkdirSync(artifacts);
      writeFileSync(join(cwd, "project.txt"), "repository-visible");
      const script = [
        'const { readFileSync, writeFileSync } = require("node:fs");',
        'if (readFileSync("project.txt", "utf8") !== "repository-visible") throw new Error("Repository unavailable");',
        'writeFileSync("artifacts/result.txt", "artifact-writable");',
        'try { writeFileSync("forbidden.txt", "bad"); throw new Error("Repository writable"); }',
        'catch (error) { if (!["EACCES", "EPERM", "EROFS"].includes(error.code)) throw error; }',
        'process.stdout.write("repository-visible; artifact-writable");',
      ].join("\n");
      const result = await withNativeCliSandbox(process.execPath, ["-e", script], {
        cwd,
        machineAuthorityOwner: "kota",
        writableRoots: [artifacts],
        env: buildNativeCliEnvironment(),
        prepareEnvironment(context, env) {
          for (const suffix of ["", "-wal", "-shm", "-journal"]) {
            expect(context.readProtectedPaths).toContain(join(cwd, ".kota", `kota.sqlite${suffix}`));
          }
          return env;
        },
      }, (child) => runNativeProcess(cwd, child));
      if (isNativeCliSandboxBootstrapError(result.stderr)) {
        skip("Host forbids nested OS sandboxes; no repository probe executed");
      }
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("repository-visible; artifact-writable");
      expect(readFileSync(join(artifacts, "result.txt"), "utf8")).toBe("artifact-writable");
      expect(existsSync(join(cwd, ".kota"))).toBe(false);
    },
  );

  it.runIf(process.platform === "darwin" || process.platform === "linux")(
    "denies non-writer reads of other scopes' database records while retaining repository access",
    async ({ skip }) => {
      const cwd = realpathSync(mkdtempSync(join(tmpdir(), "kota-native-nonwriter-")));
      roots.push(cwd);
      const stateDir = join(cwd, ".kota");
      const store = new RunStateDatabase(stateDir);
      try {
        for (const id of ["current", "unrelated"]) {
          store.registerScope({ id, rootPath: join(cwd, id), createdAt: "2026-09-07T00:00:00Z" });
        }
        store.admitRun({
          id: "private-run", scopeId: "unrelated", workflow: "private", repository: "none",
          trigger: { event: "private", schemaRef: null, payload: { secret: "other-scope-private-trigger" } },
          resources: [], admittedAt: "2026-09-07T00:00:00Z",
        });
        writeFileSync(join(cwd, "project.txt"), "repository-visible");
        const artifacts = join(stateDir, "runs", "probe", "agent");
        mkdirSync(artifacts, { recursive: true });
        const database = store.path;
        const databasePaths = [database, `${database}-wal`, `${database}-shm`, `${database}-journal`];
        for (const path of databasePaths.slice(0, 3)) expect(existsSync(path)).toBe(true);
        const script = [
          'const { readFileSync, writeFileSync } = require("node:fs");',
          'if (readFileSync("project.txt", "utf8") !== "repository-visible") throw new Error("Repository unavailable");',
          `for (const path of ${JSON.stringify(databasePaths)}) {`,
          '  try { if (readFileSync(path).length !== 0 || process.platform !== "linux") throw new Error("Database exposed"); }',
          '  catch (error) { if (!["EACCES", "EPERM"].includes(error.code)) throw error; }',
          '}',
          `writeFileSync(${JSON.stringify(join(artifacts, "result.txt"))}, "artifact-writable");`,
          'process.stdout.write("repository-visible; database-denied; artifact-writable");',
        ].join("\n");
        const result = await withNativeCliSandbox(process.execPath, ["-e", script], {
          cwd,
          machineAuthorityOwner: "kota",
          writableRoots: [artifacts],
          env: { ...buildNativeCliEnvironment(), KOTA_RUN_ARTIFACT_DIR: artifacts },
          prepareEnvironment(_context, env) {
            // A journal created after policy construction must also be protected.
            writeFileSync(`${database}-journal`, "synthetic-private-journal");
            return env;
          },
        }, (child) => runNativeProcess(cwd, child));
        if (isNativeCliSandboxBootstrapError(result.stderr)) {
          skip("Host forbids nested OS sandboxes; no read probe executed");
        }
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe("repository-visible; database-denied; artifact-writable");
        expect(readFileSync(join(artifacts, "result.txt"), "utf8")).toBe("artifact-writable");
      } finally {
        rmSync(`${store.path}-journal`, { force: true });
        store.close();
      }
    },
  );

  it("projects linked-worktree Git directories into the write-protected boundary", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-git-boundary-"));
    roots.push(root);
    const scopeRoot = join(root, "project");
    const worktreeDir = join(root, "linked");
    mkdirSync(scopeRoot);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: scopeRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: scopeRoot });
    execFileSync("git", ["config", "user.name", "test"], { cwd: scopeRoot });
    writeFileSync(join(scopeRoot, "tracked.txt"), "tracked\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: scopeRoot });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: scopeRoot });
    execFileSync("git", ["worktree", "add", "-q", "-b", "linked", worktreeDir], {
      cwd: scopeRoot,
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
      realpathSync.native(join(scopeRoot, ".git", "worktrees", "linked")),
      realpathSync.native(join(scopeRoot, ".git")),
    ]));
  });

  it.runIf(process.platform === "darwin")(
    "denies host-file reads outside declared roots",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "kota-native-read-sandbox-"));
      roots.push(root);
      const scopeRoot = join(root, "project");
      const outsidePath = join(root, "operator-credential.txt");
      const insidePath = join(scopeRoot, "project.txt");
      mkdirSync(scopeRoot);
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
          cwd: scopeRoot,
          machineAuthorityOwner: "kota",
          writableRoots: [],
          env: buildNativeCliEnvironment({
            overrides: { INSIDE_PATH: insidePath, OUTSIDE_PATH: outsidePath },
          }),
        },
        (sandboxedProcess) => runNativeProcess(scopeRoot, sandboxedProcess),
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
      const scopeRoot = mkdtempSync(join(tmpdir(), "kota-native-secret-sandbox-"));
      roots.push(scopeRoot);
      const secretPath = join(scopeRoot, ".env");
      writeFileSync(secretPath, "TOKEN=project-secret\n");

      const result = await withNativeCliSandbox(
        "/bin/sh",
        ["-c", 'cat "$TARGET"'],
        {
          cwd: scopeRoot,
          machineAuthorityOwner: "kota",
          writableRoots: [scopeRoot],
          env: buildNativeCliEnvironment({
            overrides: { TARGET: secretPath },
          }),
        },
        (sandboxedProcess) => runNativeProcess(scopeRoot, sandboxedProcess),
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
      const scopeRoot = mkdtempSync(join(tmpdir(), "kota-native-config-sandbox-"));
      roots.push(scopeRoot);
      const configurationRoot = join(scopeRoot, ".gemini");
      const settingsPath = join(configurationRoot, "settings.json");
      mkdirSync(configurationRoot);
      writeFileSync(settingsPath, JSON.stringify({
        mcpServers: { hostile: { command: "read-provider-auth" } },
      }));

      const result = await withNativeCliSandbox(
        "/bin/sh",
        ["-c", 'cat "$TARGET"'],
        {
          cwd: scopeRoot,
          machineAuthorityOwner: "kota",
          writableRoots: [scopeRoot],
          readProtectedRoots: [configurationRoot],
          env: buildNativeCliEnvironment({
            overrides: { TARGET: settingsPath },
          }),
        },
        (sandboxedProcess) => runNativeProcess(scopeRoot, sandboxedProcess),
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
        const scopeRoot = mkdtempSync(join(tmpdir(), "kota-native-egress-sandbox-"));
        roots.push(scopeRoot);
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
            cwd: scopeRoot,
            machineAuthorityOwner: "kota",
            writableRoots: [],
            env: buildNativeCliEnvironment({
              overrides: { TARGET_PORT: String(address.port) },
            }),
            allowedEgressHosts: ["chatgpt.com"],
          },
          (sandboxedProcess) => runNativeProcess(scopeRoot, sandboxedProcess),
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

  it("projects the persisted daemon lock into native CLI read denials", async () => {
    const scopeRoot = realpathSync(mkdtempSync(join(tmpdir(), "kota-native-lock-")));
    roots.push(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"));
    const lock = join(scopeRoot, ".kota", "daemon-instance.lock");
    writeFileSync(lock, JSON.stringify({ token: "synthetic-instance-lock-bearer" }));
    const publicPath = join(scopeRoot, "public.txt");
    writeFileSync(publicPath, "repository-visible");
    await withNativeCliSandbox("/bin/sh", [], {
      cwd: scopeRoot,
      machineAuthorityOwner: "native-cli",
      writableRoots: [scopeRoot],
      env: buildNativeCliEnvironment(),
      prepareEnvironment(context, env) {
        expect(context.readProtectedPaths).toContain(lock);
        expect(context.readProtectedPaths).not.toContain(publicPath);
        expect(context.readableRoots).toContain(scopeRoot);
        return env;
      },
    }, async () => undefined);
  });

  it("lets a native CLI own the sandbox without an outer wrapper", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-native-owned-sandbox-"));
    roots.push(scopeRoot);

    const process = await withNativeCliSandbox(
      "/bin/sh",
      ["-c", "true"],
      {
        cwd: scopeRoot,
        machineAuthorityOwner: "native-cli",
        writableRoots: [scopeRoot],
        env: buildNativeCliEnvironment(),
      },
      async (sandboxedProcess) => sandboxedProcess,
    );

    expect(process.command).toBe("/bin/sh");
    expect(process.args).toEqual(["-c", "true"]);
    expect(process.env.HOME).toContain("kota-native-cli-");
  });
});
