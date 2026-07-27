import type { ChildProcess } from "node:child_process";

type ProcessLifecycle = {
  proc: ChildProcess;
  exited: boolean;
  killing: boolean;
  detachEnvironmentCleanup: (() => void) | null;
};

export function deliverProcessSignal(
  managed: ProcessLifecycle,
  signal: NodeJS.Signals,
): boolean {
  if (process.platform !== "win32" && managed.proc.pid !== undefined) {
    try {
      return process.kill(-managed.proc.pid, signal);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "ESRCH") return false;
    }
  }
  return managed.proc.kill(signal);
}

export function beginProcessTermination(managed: ProcessLifecycle): void {
  if (managed.exited || managed.killing) return;
  managed.killing = true;
  try {
    deliverProcessSignal(managed, "SIGTERM");
  } catch {
    // The process has already exited.
  }
  const timer = setTimeout(() => {
    if (managed.exited) return;
    try {
      deliverProcessSignal(managed, "SIGKILL");
    } catch {
      // The process exited during the grace period.
    }
  }, 2000);
  timer.unref();
}

export function detachEnvironmentCleanup(managed: ProcessLifecycle): void {
  managed.detachEnvironmentCleanup?.();
  managed.detachEnvironmentCleanup = null;
}
