import { spawn } from "node:child_process";
import { RESTART_EXIT_CODE } from "#core/daemon/daemon.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { DAEMON_CHILD_ENV } from "./daemon-cli-options.js";

export async function runDaemonSupervisor(): Promise<void> {
  const childArgs = process.argv.slice(1);
  let forwardSignal: ((signal: NodeJS.Signals) => void) | null = null;
  try {
    while (true) {
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, ...childArgs], {
          stdio: "inherit",
          env: withProtectedGitBareRepositoryEnv({
            ...process.env,
            [DAEMON_CHILD_ENV]: String(process.pid),
          }),
        });
        forwardSignal = (signal) => child.kill(signal);
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
      if (exitCode !== RESTART_EXIT_CODE) {
        process.exitCode = exitCode;
        return;
      }
    }
  } finally {
    if (forwardSignal) {
      process.removeListener("SIGINT", forwardSignal);
      process.removeListener("SIGTERM", forwardSignal);
    }
  }
}
