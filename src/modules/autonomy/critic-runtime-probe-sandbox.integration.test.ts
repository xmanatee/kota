import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { runProbeIfDeclared } from "./critic-runtime-probe.js";

const DETACHED_PROCESS_STARTED = "KOTA_RUNTIME_PROBE_DETACHED_PROCESS_STARTED";
const DETACHED_PROCESS_SURVIVED =
  "KOTA_RUNTIME_PROBE_DETACHED_PROCESS_SURVIVED";

function runGit(dir: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function makeFixture(mode: "staged" | "untracked") {
  const parent = join(
    tmpdir(),
    `kota-probe-containment-${mode}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const workspaceRoot = join(parent, "project");
  const taskName = `task-${mode}-package-probe.md`;
  const taskPath = join(workspaceRoot, "data/tasks", taskName);
  const outsideMarker = join(parent, "outside-marker.txt");
  const outsideHardLinkMarker = join(parent, "outside-hard-link-marker.txt");
  const insideHardLink = join(workspaceRoot, "host-hard-link.txt");
  const packageLaunchMarker = join(workspaceRoot, "package-code-ran.txt");
  const packageSocket = join(workspaceRoot, "package-created.sock");
  const outsideSecret = join(parent, "outside-secret.txt");
  const outsideSocket = join(
    tmpdir(),
    `kota-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
  );
  mkdirSync(dirname(taskPath), { recursive: true });
  writeFileSync(outsideSecret, "HOST_FILE_READ_SUCCEEDED");
  writeFileSync(outsideHardLinkMarker, "host-hard-link-only");
  linkSync(outsideHardLinkMarker, insideHardLink);
  const taskContent = [
    "---",
    "status: open",
    "priority: p2",
    "---",
    "",
    `# ${mode} package probe`,
    "",
    "## Runtime Probe",
    "command: pnpm run probe:escape",
    "timeoutMs: 5000",
  ].join("\n");
  writeFileSync(taskPath, taskContent);
  runGit(workspaceRoot, ["init"]);
  runGit(workspaceRoot, ["config", "user.email", "test@example.com"]);
  runGit(workspaceRoot, ["config", "user.name", "Test User"]);
  runGit(workspaceRoot, ["add", "data/tasks"]);
  runGit(workspaceRoot, ["commit", "-m", "seed trusted task"]);
  const detachedProgram = [
    'if (typeof process.send !== "function") process.exit(40)',
    'process.send("open", () => process.disconnect())',
    `setTimeout(() => process.stderr.write(${JSON.stringify(DETACHED_PROCESS_SURVIVED)}), 800)`,
  ].join("; ");
  const escapeProgram = [
    'const fs = require("node:fs")',
    'const net = require("node:net")',
    'const { spawn, spawnSync } = require("node:child_process")',
    `fs.writeFileSync(${JSON.stringify(packageLaunchMarker)}, "ran")`,
    `if (fs.readFileSync(${JSON.stringify(packageLaunchMarker)}, "utf8") !== "ran") process.exit(30)`,
    'console.log("PACKAGE_CODE_RAN")',
    "let packageSocketReady = false",
    "let outsideSocketRejected = false",
    "let detachedProcessReady = false",
    "const finish = () => { if (packageSocketReady && outsideSocketRejected && detachedProcessReady) process.exit(0) }",
    `const packageServer = net.createServer(); packageServer.listen(${JSON.stringify(packageSocket)}, () => { packageSocketReady = true; console.log("PACKAGE_SOCKET_CREATED"); finish() })`,
    `const detached = spawn(process.execPath, ["-e", ${JSON.stringify(detachedProgram)}], { detached: true, stdio: ["ignore", "ignore", "inherit", "ipc"] })`,
    `detached.once("message", () => { detachedProcessReady = true; console.log(${JSON.stringify(DETACHED_PROCESS_STARTED)}); detached.unref(); finish() })`,
    `try { console.log(fs.readFileSync(${JSON.stringify(outsideSecret)}, "utf8")) } catch {}`,
    `try { fs.writeFileSync(${JSON.stringify(outsideMarker)}, "escaped") } catch {}`,
    `try { fs.writeFileSync(${JSON.stringify(insideHardLink)}, "escaped-through-hard-link") } catch {}`,
    'const appleEvent = spawnSync("/usr/bin/osascript", ["-e", "return \\"HOST_APPLEEVENT_EXECUTED\\""], { encoding: "utf8" })',
    'if (appleEvent.status === 0) console.log(appleEvent.stdout)',
    `const client = net.connect(${JSON.stringify(outsideSocket)})`,
    'client.once("connect", () => { console.log("HOST_IPC_CONNECTED"); process.exit(21) })',
    'client.once("error", () => { outsideSocketRejected = true; finish() })',
    "setTimeout(() => process.exit(31), 500)",
  ].join("; ");
  writeFileSync(
    join(workspaceRoot, "package.json"),
    JSON.stringify(
      {
        name: "untrusted-probe-package",
        version: "0.0.0",
        scripts: {
          "probe:escape": `node -e ${JSON.stringify(escapeProgram)}`,
        },
      },
      null,
      2,
    ),
  );
  if (mode === "staged") {
    runGit(workspaceRoot, ["add", "package.json", "host-hard-link.txt"]);
  }
  const runDir = join(workspaceRoot, ".kota/runs/test-run");
  mkdirSync(runDir, { recursive: true });
  return {
    parent,
    workspaceRoot,
    taskPath,
    outsideMarker,
    outsideHardLinkMarker,
    outsideSocket,
    packageLaunchMarker,
    packageSocket,
    runDir,
    taskContent,
  };
}

function makeFifo(path: string): void {
  const executable = ["/usr/bin/mkfifo", "/bin/mkfifo"].find((candidate) =>
    existsSync(candidate),
  );
  if (executable === undefined) throw new Error("mkfifo is unavailable");
  const result = spawnSync(executable, [path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`mkfifo failed: ${result.stderr}`);
}

function listenOnUnixSocket(
  path: string,
): Promise<ReturnType<typeof createServer> | null> {
  const server = createServer((socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EACCES" || error.code === "EPERM") {
        rmSync(path, { force: true });
        resolve(null);
      } else {
        reject(error);
      }
    });
    server.listen(path, () => resolve(server));
  });
}

function closeUnixSocket(
  server: ReturnType<typeof createServer>,
  path: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      rmSync(path, { force: true });
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("Runtime Probe mutable workspace containment", () => {
  it.each(["staged", "untracked"] as const)(
    "does not let %s package code escape filesystem, host-service, or process-lifetime boundaries",
    async (mode) => {
      const fixture = makeFixture(mode);
      const hostServer = await listenOnUnixSocket(fixture.outsideSocket);

      try {
        const result = await runProbeIfDeclared(
          fixture.taskContent,
          fixture.taskPath,
          fixture.workspaceRoot,
          fixture.runDir,
          createWorkflowCommandRunner({ cwd: fixture.workspaceRoot }),
        );

        expect(result).not.toBeNull();
        expect(result?.output).not.toContain("HOST_IPC_CONNECTED");
        expect(result?.output).not.toContain("HOST_FILE_READ_SUCCEEDED");
        expect(result?.output).not.toContain("HOST_APPLEEVENT_EXECUTED");
        expect(existsSync(fixture.outsideMarker)).toBe(false);
        expect(readFileSync(fixture.outsideHardLinkMarker, "utf8")).toBe(
          "host-hard-link-only",
        );
        expect(existsSync(fixture.packageLaunchMarker)).toBe(false);
        expect(existsSync(fixture.packageSocket)).toBe(false);
        expect(result?.output).not.toContain(DETACHED_PROCESS_SURVIVED);
        const artifact = JSON.parse(
          readFileSync(join(fixture.runDir, "runtime-probe.json"), "utf8"),
        );
        expect(artifact.provenance).toMatchObject({
          status: "trusted",
          sourcePath: `data/tasks/task-${mode}-package-probe.md`,
        });
        if (artifact.isolation.status === "enforced") {
          expect(result).toMatchObject({
            verdict: "pass",
            execution: "os-contained-command",
          });
          expect(result?.output).toContain("PACKAGE_CODE_RAN");
          expect(result?.output).toContain("PACKAGE_SOCKET_CREATED");
          expect(result?.output).toContain(DETACHED_PROCESS_STARTED);
          expect(artifact).toMatchObject({
            verdict: "pass",
            execution: "os-contained-command",
          });
          expect(artifact.output).toContain("PACKAGE_CODE_RAN");
          expect(artifact.output).not.toContain(DETACHED_PROCESS_SURVIVED);
        } else {
          expect(artifact.execution).toBe("not-executed");
          expect(artifact.verdict).toBe("fail");
          expect(artifact.output).toContain("Runtime Probe not executed");
        }
      } finally {
        if (hostServer === null) {
          rmSync(fixture.outsideSocket, { force: true });
        } else {
          await closeUnixSocket(hostServer, fixture.outsideSocket);
        }
        rmSync(fixture.parent, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "fails closed before package launch when the workspace contains an ordinary FIFO",
    async () => {
      const fixture = makeFixture("untracked");
      makeFifo(join(fixture.workspaceRoot, "host.fifo"));

      try {
        const result = await runProbeIfDeclared(
          fixture.taskContent,
          fixture.taskPath,
          fixture.workspaceRoot,
          fixture.runDir,
          createWorkflowCommandRunner({ cwd: fixture.workspaceRoot }),
        );

        expect(result).toMatchObject({
          verdict: "fail",
          execution: "not-executed",
          isolation: { status: "unavailable" },
        });
        expect(result?.output).toMatch(
          /contains a FIFO|requires a Linux PID namespace|requires Bubblewrap and prlimit/,
        );
        expect(existsSync(fixture.packageLaunchMarker)).toBe(false);
        expect(existsSync(fixture.outsideMarker)).toBe(false);
      } finally {
        rmSync(fixture.parent, { recursive: true, force: true });
      }
    },
  );
});
