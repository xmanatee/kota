/**
 * Subprocess-backed workflow executor.
 *
 * Invokes `kota workflow exec <name>` inside the fixture's isolated working
 * directory. The exec command runs the full workflow synchronously without a
 * daemon and exits only when the run reaches a terminal status, so the
 * subprocess boundary is the fixture isolation boundary and the child process
 * lifetime is the run lifetime. When the child exceeds the fixture budget the
 * executor kills it with SIGTERM and reports `timeout`.
 *
 * Fixture authors prepare the minimal KOTA project setup the targeted
 * workflow needs (e.g. seeded `data/` queue) in `initial/`. The executor
 * remaps `HOME` and `KOTA_PROJECT_DIR` to the working directory so
 * credential-driven side effects cannot leak from the operator's real
 * environment.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { REPLAY_AGENT_HARNESS_NAME_ENV } from "./replay-harness.js";
import type {
  WorkflowExecutionOutcome,
  WorkflowExecutionRequest,
  WorkflowExecutor,
} from "./runner.js";

export type SubprocessExecutorOptions = {
  /** Path to the `kota` binary (`./bin/kota.mjs` when running from the repo). */
  kotaBinaryPath: string;
  /**
   * Extra env vars to forward to the subprocess. The fixture's HOME is
   * deliberately pointed at the working directory so credential-driven side
   * effects cannot leak from the operator's real environment.
   */
  extraEnv?: Record<string, string>;
};

type RunMetadataSnapshot = {
  id: string;
  status: string;
};

function readTerminalRunForWorkflow(
  workingDir: string,
  workflowName: string,
): RunMetadataSnapshot | null {
  const runsDir = join(workingDir, ".kota", "runs");
  if (!existsSync(runsDir)) return null;
  const entries = readdirSync(runsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.includes(workflowName)) continue;
    const metadataPath = join(runsDir, entry.name, "metadata.json");
    if (!existsSync(metadataPath)) continue;
    const raw = JSON.parse(readFileSync(metadataPath, "utf-8")) as {
      id?: unknown;
      status?: unknown;
      workflow?: unknown;
    };
    if (raw.workflow !== workflowName) continue;
    if (
      typeof raw.status === "string" &&
      raw.status !== "running" &&
      typeof raw.id === "string"
    ) {
      return { id: raw.id, status: raw.status };
    }
  }
  return null;
}

/**
 * Build a production-grade subprocess executor. Designed for the cadence
 * workflow and the CLI to use. Unit tests do not use this — they inject
 * lightweight in-process executors to avoid shell and network I/O.
 */
export function createSubprocessExecutor(
  options: SubprocessExecutorOptions,
): WorkflowExecutor {
  return {
    async execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionOutcome> {
      const startMs = Date.now();

      // Derive the KOTA dist directory from the binary path so fixture
      // scripts (e.g. a minimal `package.json` whose "validate-tasks"
      // entry forwards to the real validator) can resolve it without
      // hard-coding the operator's checkout path. `bin/kota.mjs` lives
      // one directory above `dist/`.
      const kotaRoot = dirname(dirname(resolve(options.kotaBinaryPath)));
      const kotaDistDir = join(kotaRoot, "dist");

      const env = {
        ...process.env,
        ...(options.extraEnv ?? {}),
        HOME: request.workingDir,
        KOTA_PROJECT_DIR: request.workingDir,
        KOTA_DIST_DIR: kotaDistDir,
        ...(request.replayRecordingsRoot !== undefined && {
          [REPLAY_AGENT_HARNESS_NAME_ENV]: request.replayRecordingsRoot,
        }),
      };

      const execArgs = [
        options.kotaBinaryPath,
        "workflow",
        "exec",
        request.workflowName,
      ];
      if (request.triggerPayload !== undefined) {
        execArgs.push("--payload", JSON.stringify(request.triggerPayload));
      }
      const child = spawn("node", execArgs, {
        cwd: request.workingDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.resume();
      // Forward child stderr to the parent so module-load diagnostics and
      // workflow-step errors surface in `pnpm kota eval run` output. Parent
      // logs include the same information the daemon would; piping through
      // here keeps fixture failures debuggable without reading tmp dirs.
      child.stderr.on("data", (chunk) => {
        process.stderr.write(chunk);
      });

      let timedOut = false;
      const budgetTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, request.budgetMs);

      const { code, spawnError } = await new Promise<{
        code: number | null;
        spawnError: Error | null;
      }>((resolve) => {
        child.on("exit", (exitCode) => resolve({ code: exitCode, spawnError: null }));
        child.on("error", (err) => resolve({ code: null, spawnError: err }));
      });
      clearTimeout(budgetTimer);

      const durationMs = Date.now() - startMs;

      if (timedOut) {
        return {
          kind: "timeout",
          durationMs,
          runArtifactPath: null,
        };
      }

      if (spawnError) {
        return {
          kind: "error",
          durationMs,
          message: `Failed to spawn kota workflow exec: ${spawnError.message}`,
          runArtifactPath: null,
        };
      }

      const terminal = readTerminalRunForWorkflow(
        request.workingDir,
        request.workflowName,
      );
      const runArtifactPath = terminal
        ? join(request.workingDir, ".kota", "runs", terminal.id)
        : null;

      if (code !== 0) {
        return {
          kind: "error",
          durationMs,
          message: terminal
            ? `kota workflow exec exited with status ${code}; run ${terminal.id} terminal status: ${terminal.status}.`
            : `kota workflow exec exited with status ${code}; no terminal run produced.`,
          runArtifactPath,
        };
      }

      if (!terminal) {
        return {
          kind: "error",
          durationMs,
          message:
            "kota workflow exec exited cleanly but produced no terminal run artifact.",
          runArtifactPath: null,
        };
      }

      return {
        kind: "completed",
        durationMs,
        runArtifactPath,
      };
    },
  };
}
