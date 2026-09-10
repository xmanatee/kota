import { ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { RESTART_EXIT_CODE } from "#core/daemon/daemon.js";
import { acquireInstanceLock, releaseInstanceLock } from "#core/daemon/daemon-instance-lock.js";
import { completeRuntimeActivation, initializeRuntimeActivation } from "#core/daemon/daemon-runtime-activation.js";
import { loadDaemonStateFromDisk, saveDaemonStateToDisk } from "#core/daemon/daemon-state-persistence.js";
import { prepareDaemonStateRoot } from "#core/daemon/daemon-state-root.js";
import { DAEMON_SUPERVISOR_TOKEN_ENV } from "./daemon-cli-options.js";
import { runDaemonSupervisor } from "./daemon-supervisor.js";

const loaded = vi.hoisted(() => ({ root: "", mode: "built" as const, loadedRevision: "" }));
vi.mock("#core/daemon/daemon-runtime-revision.js", async (original) => ({
  ...await original<typeof import("#core/daemon/daemon-runtime-revision.js")>(),
  LOADED_RUNTIME: loaded,
  captureLoadedRuntime: () => ({ ...loaded }),
}));
vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(), spawn: vi.fn(),
}));

it.each(["active", "starting", "draining", "failed"] as const)("rejects a duplicate start without changing the live owner's %s activation", async (status) => {
  const root = mkdtempSync(join(tmpdir(), "kota-supervisor-contender-"));
  const stateRoot = prepareDaemonStateRoot(root, undefined);
  const owner = { pid: process.pid, startedAt: new Date().toISOString(), token: "live-owner" };
  loaded.root = root;
  loaded.loadedRevision = "a".repeat(40);
  try {
    await acquireInstanceLock(root, stateRoot, owner, () => {});
    saveDaemonStateToDisk(stateRoot.path, {
      pid: process.pid, startedAt: owner.startedAt,
      runtimeRevision: {
        ...loaded, canonicalRevision: loaded.loadedRevision,
        activation: { targetRevision: loaded.loadedRevision, status, error: null },
      },
    });
    const stateBefore = readFileSync(join(stateRoot.path, "daemon-state.json"), "utf8");
    const lockBefore = readFileSync(join(stateRoot.path, "daemon-instance.lock"), "utf8");
    vi.mocked(spawn).mockClear();
    await expect(runDaemonSupervisor(root)).rejects.toThrow("Another daemon instance is starting or running");
    expect(spawn).not.toHaveBeenCalled();
    expect(readFileSync(join(stateRoot.path, "daemon-state.json"), "utf8")).toBe(stateBefore);
    expect(readFileSync(join(stateRoot.path, "daemon-instance.lock"), "utf8")).toBe(lockBefore);
  } finally {
    releaseInstanceLock(stateRoot, owner);
    rmSync(root, { recursive: true, force: true });
  }
});

it("retains the supervisor reservation across real child shutdown and replacement", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-supervisor-handoff-"));
  const stateRoot = prepareDaemonStateRoot(root, undefined);
  const { spawn: spawnChild } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const previousExitCode = process.exitCode;
  loaded.root = root;
  loaded.loadedRevision = "a".repeat(40);
  saveDaemonStateToDisk(stateRoot.path, {
    pid: 123, startedAt: new Date().toISOString(),
    runtimeRevision: {
      ...loaded, canonicalRevision: loaded.loadedRevision,
      activation: { targetRevision: loaded.loadedRevision, status: "active", error: null },
    },
  });
  let launches = 0;
  let stderr = "";
  vi.mocked(spawn).mockImplementation((_command, _args, options) => {
    launches++;
    const script = `
      import { assertSupervisorInstanceLock, releaseInstanceLock, writeControlFile } from '#core/daemon/daemon-instance-lock.js';
      import { prepareDaemonStateRoot } from '#core/daemon/daemon-state-root.js';
      import { loadDaemonStateFromDisk } from '#core/daemon/daemon-state-persistence.js';
      import { completeRuntimeActivation } from '#core/daemon/daemon-runtime-activation.js';
      const stateRoot = prepareDaemonStateRoot(process.argv[1], undefined);
      const token = process.env[process.argv[2]];
      assertSupervisorInstanceLock(stateRoot, token);
      const identity = { pid: process.pid, startedAt: new Date().toISOString(), token: 'child-control-token' };
      writeControlFile(stateRoot, { ...identity, port: 3921 });
      completeRuntimeActivation(loadDaemonStateFromDisk(stateRoot.path), stateRoot.path);
      releaseInstanceLock(stateRoot, identity);
      assertSupervisorInstanceLock(stateRoot, token);
      process.exitCode = Number(process.argv[3]);
    `;
    const child = spawnChild(process.execPath, [
      "--conditions=source", "--import", "tsx", "--input-type=module", "--eval", script,
      root, DAEMON_SUPERVISOR_TOKEN_ENV, String(launches === 1 ? RESTART_EXIT_CODE : 0),
    ], { env: options?.env, stdio: "pipe" });
    child.stderr.on("data", (data) => { stderr += String(data); });
    return child;
  });
  try {
    await runDaemonSupervisor(root);
    expect(stderr).toBe("");
    expect(process.exitCode).toBe(0);
    expect(launches).toBe(2);
    expect(loadDaemonStateFromDisk(stateRoot.path)?.runtimeRevision?.activation?.status).toBe("active");
    expect(existsSync(join(stateRoot.path, "daemon-instance.lock"))).toBe(false);
    expect(existsSync(join(stateRoot.path, "daemon-control.json"))).toBe(false);
  } finally {
    process.exitCode = previousExitCode;
    vi.mocked(spawn).mockReset();
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  { signal: "SIGTERM", restartOnStop: false },
  { signal: "SIGINT", restartOnStop: false },
  { signal: "SIGTERM", restartOnStop: true },
] as const)("cancels replacement preflight on $signal (restart exit: $restartOnStop) and permits the same runtime to restart", async ({ signal, restartOnStop }) => {
  const root = mkdtempSync(join(tmpdir(), "kota-supervisor-stop-"));
  const stateRoot = prepareDaemonStateRoot(root, undefined);
  const { spawn: spawnChild } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const previousExitCode = process.exitCode;
  const originalListeners = process.listeners(signal);
  const originalInterruptListeners = process.listeners("SIGINT");
  const originalTerminateListeners = process.listeners("SIGTERM");
  loaded.root = root;
  loaded.loadedRevision = "a".repeat(40);
  saveDaemonStateToDisk(stateRoot.path, {
    pid: 123, startedAt: new Date().toISOString(),
    runtimeRevision: {
      ...loaded, canonicalRevision: loaded.loadedRevision,
      activation: { targetRevision: loaded.loadedRevision, status: "active", error: null },
    },
  });
  const children: ChildProcess[] = [];
  let preflightReady = false;
  let stderr = "";
  vi.mocked(spawn).mockImplementation((_command, _args, options) => {
    const launch = children.length + 1;
    const script = launch === 2 ? `
      ${restartOnStop ? `process.on('${signal}', () => process.exit(${RESTART_EXIT_CODE}));` : ""}
      setInterval(() => {}, 60_000);
      process.stdout.write('preflight ready');
    ` : `process.exitCode = ${launch === 1 ? RESTART_EXIT_CODE : 0};`;
    const child = spawnChild(process.execPath, ["--eval", script], { env: options?.env, stdio: "pipe" });
    child.stdout.once("data", () => { preflightReady = true; });
    child.stderr.on("data", (data) => { stderr += String(data); });
    children.push(child);
    return child;
  });
  const stopSupervisor = () => {
    const stop = process.listeners(signal).find((listener) => !originalListeners.includes(listener));
    expect(stop).toBeDefined();
    stop!(signal);
  };
  let running: Promise<void> | undefined;
  try {
    let exited = false;
    running = runDaemonSupervisor(root).then(() => { exited = true; });
    await vi.waitFor(() => expect(preflightReady).toBe(true));
    expect(existsSync(join(stateRoot.path, "daemon-instance.lock"))).toBe(true);
    stopSupervisor();
    await vi.waitFor(() => expect(exited).toBe(true));
    await running;
    running = undefined;
    expect(process.exitCode).toBe(0);
    expect(children).toHaveLength(2);
    expect(children[1]!.exitCode).toBe(restartOnStop ? RESTART_EXIT_CODE : null);
    expect(children[1]!.signalCode).toBe(restartOnStop ? null : signal);
    expect(loadDaemonStateFromDisk(stateRoot.path)?.runtimeRevision?.activation).toEqual({
      targetRevision: loaded.loadedRevision, status: "starting", error: null,
    });
    expect(existsSync(join(stateRoot.path, "daemon-instance.lock"))).toBe(false);
    // The unchanged revision must still be admitted after cancellation.
    await runDaemonSupervisor(root);
    expect(children).toHaveLength(3);
    expect(process.exitCode).toBe(0);
    expect(existsSync(join(stateRoot.path, "daemon-instance.lock"))).toBe(false);
    expect(stderr).toBe("");
    expect(process.listeners("SIGINT")).toEqual(originalInterruptListeners);
    expect(process.listeners("SIGTERM")).toEqual(originalTerminateListeners);
  } finally {
    if (running) {
      stopSupervisor();
      await running;
    }
    process.exitCode = previousExitCode;
    vi.mocked(spawn).mockReset();
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  { status: "draining", failure: "stale-build" },
  { status: "draining", failure: "spawn-error" },
  { status: "active", failure: "spawn-error" },
  { status: "active", failure: "preflight-exit" },
] as const)("parks $status activation after $failure across service relaunches and retries only changed runtime code", async ({ status, failure }) => {
  const root = mkdtempSync(join(tmpdir(), "kota-supervisor-activation-"));
  const stateDir = join(root, ".kota");
  mkdirSync(stateDir);
  mkdirSync(join(root, "src"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  const commit = (path: string, content: string) => {
    writeFileSync(join(root, path), content);
    git("add", path);
    git("commit", "-qm", "runtime revision");
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "KOTA Test");
  git("config", "user.email", "kota@example.test");
  git("config", "commit.gpgsign", "false");
  loaded.root = root;
  loaded.loadedRevision = commit("src/runtime.ts", "export const value = 1;\n");
  const docsRevision = commit("README.md", "documentation\n");
  const changedRevision = commit("src/runtime.ts", "export const value = 2;\n");
  const targetRevision = status === "active" ? loaded.loadedRevision : changedRevision;
  const failedLaunch = status === "active" ? 1 : 2;
  saveDaemonStateToDisk(stateDir, {
    pid: 123, startedAt: new Date().toISOString(),
    runtimeRevision: {
      ...loaded, canonicalRevision: targetRevision,
      activation: { targetRevision, status, error: null },
    },
  });
  const previousExitCode = process.exitCode;
  const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const originalSignalListeners = process.listeners("SIGTERM");
  let launches = 0;
  vi.mocked(spawn).mockImplementation(() => {
    const child = new ChildProcess();
    launches++;
    queueMicrotask(() => {
      if (status === "draining" && launches === 1) {
        child.emit("exit", RESTART_EXIT_CODE, null);
        return;
      }
      if (failure === "spawn-error" && launches === failedLaunch) {
        child.emit("error", new Error("replacement spawn failed"));
        return;
      }
      if (failure === "preflight-exit" && launches === failedLaunch) {
        child.emit("exit", 1, null);
        return;
      }
      const state = loadDaemonStateFromDisk(stateDir)!;
      try {
        initializeRuntimeActivation(state, stateDir);
        completeRuntimeActivation(state, stateDir);
        child.emit("exit", 0, null);
      } catch {
        child.emit("exit", 1, null);
      }
    });
    return child;
  });
  const stopParkedSupervisor = () => {
    const stop = process.listeners("SIGTERM").find((listener) => !originalSignalListeners.includes(listener));
    expect(stop).toBeDefined();
    stop!("SIGTERM");
  };
  let running: Promise<void> | undefined;
  try {
    for (const revision of [loaded.loadedRevision, loaded.loadedRevision, docsRevision]) {
      loaded.loadedRevision = revision;
      log.mockClear();
      let exited = false;
      running = runDaemonSupervisor(root).then(() => { exited = true; });
      await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining("Supervisor parked")));
      expect(exited).toBe(false);
      expect(launches).toBe(failedLaunch);
      expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision?.activation).toEqual({
        targetRevision, status: "failed",
        error: failure === "spawn-error" ? "replacement spawn failed"
          : failure === "preflight-exit" ? "Supervised daemon exited with code 1"
          : "Restart did not load the requested runtime revision; rebuild the installed runtime before retrying.",
      });
      stopParkedSupervisor();
      await running;
      running = undefined;
      expect(process.exitCode).toBe(0);
    }
    loaded.loadedRevision = changedRevision;
    await runDaemonSupervisor(root);
    expect(launches).toBe(failedLaunch + 1);
    expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision?.activation).toEqual({
      targetRevision, status: "active", error: null,
    });
    expect(process.listeners("SIGTERM")).toEqual(originalSignalListeners);
  } finally {
    if (running) {
      stopParkedSupervisor();
      await running;
    }
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  }
});
