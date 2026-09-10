import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { RESTART_EXIT_CODE } from "#core/daemon/daemon.js";
import { acquireInstanceLock, releaseInstanceLock } from "#core/daemon/daemon-instance-lock.js";
import { failRuntimeActivation, runtimeActivationRetryBlocked } from "#core/daemon/daemon-runtime-activation.js";
import { captureLoadedRuntime } from "#core/daemon/daemon-runtime-revision.js";
import { loadDaemonStateFromDisk, saveDaemonStateToDisk } from "#core/daemon/daemon-state-persistence.js";
import { prepareDaemonStateRoot } from "#core/daemon/daemon-state-root.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { DAEMON_CHILD_ENV, DAEMON_SUPERVISOR_TOKEN_ENV } from "./daemon-cli-options.js";

function recordActivationFailure(scopeRoot: string, reason: string, attempted: ReturnType<typeof captureLoadedRuntime>): boolean {
  const stateDir = join(scopeRoot, ".kota");
  const state = loadDaemonStateFromDisk(stateDir);
  const runtime = state?.runtimeRevision;
  if (state === null || runtime?.root !== attempted.root || runtime.activation === null || runtime.activation.status === "active") return false;
  // Preflight can fail before the child creates its daemon context. Retain the
  // attempted executable identity too, so a service relaunch cannot retry it.
  if (runtime.loadedRevision !== attempted.loadedRevision || runtime.mode !== attempted.mode) {
    Object.assign(runtime, attempted);
    runtime.activation.error = reason;
  }
  failRuntimeActivation(state, stateDir, reason);
  saveDaemonStateToDisk(stateDir, state);
  return true;
}

async function parkFailedActivation(): Promise<void> {
  process.stderr.write("Runtime activation failed. Supervisor parked; inspect daemon status, install a changed runtime, then restart the service.\n");
  // KeepAlive services must stay resident: even a successful exit causes
  // launchd to relaunch. Only an operator/service stop releases this process.
  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => {}, 60_000);
    const stop = () => {
      clearInterval(keepAlive);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  process.exitCode = 0;
}

export async function runDaemonSupervisor(scopeRoot: string): Promise<void> {
  let attempted = captureLoadedRuntime();
  const stateRoot = prepareDaemonStateRoot(scopeRoot, undefined);
  const owner = { pid: process.pid, startedAt: new Date().toISOString(), token: randomBytes(32).toString("hex") };
  try {
    await acquireInstanceLock(scopeRoot, stateRoot, owner, (message) => { process.stderr.write(`${message}\n`); });
  } catch (error) {
    // Acquisition can reserve a lock before rejecting a live control-file owner.
    // It must never enter activation failure handling for a rejected contender.
    releaseInstanceLock(stateRoot, owner);
    throw error;
  }
  const childArgs = process.argv.slice(1);
  let shutdownRequested = false;
  let forwardSignal: ((signal: NodeJS.Signals) => void) | null = null;
  try {
    while (true) {
      attempted = captureLoadedRuntime();
      const stateDir = join(scopeRoot, ".kota");
      const state = loadDaemonStateFromDisk(stateDir);
      const previous = state?.runtimeRevision;
      if (runtimeActivationRetryBlocked(previous, attempted)) {
        await parkFailedActivation();
        return;
      }
      if (state && previous?.root === attempted.root && previous.activation?.status === "active") {
        // Prior readiness cannot vouch for a replacement that has yet to spawn,
        // authenticate, or load its modules. Include those failures in activation.
        previous.activation.status = "starting";
        saveDaemonStateToDisk(stateDir, state);
      }
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, ...childArgs], {
          stdio: "inherit",
          env: withProtectedGitBareRepositoryEnv({
            ...process.env,
            [DAEMON_CHILD_ENV]: String(process.pid),
            [DAEMON_SUPERVISOR_TOKEN_ENV]: owner.token,
          }),
        });
        forwardSignal = (signal) => {
          shutdownRequested = true;
          child.kill(signal);
        };
        process.on("SIGINT", forwardSignal);
        process.on("SIGTERM", forwardSignal);
        const clearForwarder = () => {
          if (!forwardSignal) return;
          process.removeListener("SIGINT", forwardSignal);
          process.removeListener("SIGTERM", forwardSignal);
          forwardSignal = null;
        };
        child.once("error", (error) => {
          clearForwarder();
          reject(error);
        });
        child.once("exit", (code) => {
          clearForwarder();
          resolve(code ?? 1);
        });
      });
      if (shutdownRequested) {
        process.exitCode = 0;
        return;
      }
      if (exitCode !== RESTART_EXIT_CODE) {
        if (exitCode !== 0) {
          if (recordActivationFailure(scopeRoot, `Supervised daemon exited with code ${exitCode}`, attempted)) {
            await parkFailedActivation();
            return;
          }
        }
        process.exitCode = exitCode;
        return;
      }
    }
  } catch (error) {
    if (shutdownRequested) {
      process.exitCode = 0;
      return;
    }
    if (recordActivationFailure(scopeRoot, error instanceof Error ? error.message : String(error), attempted)) {
      await parkFailedActivation();
      return;
    }
    throw error;
  } finally {
    releaseInstanceLock(stateRoot, owner);
    if (forwardSignal) {
      process.removeListener("SIGINT", forwardSignal);
      process.removeListener("SIGTERM", forwardSignal);
    }
  }
}
