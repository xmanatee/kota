/**
 * Subprocess-backed workflow executor.
 *
 * Invokes `pnpm kota workflow trigger <name>` inside the fixture's isolated
 * working directory, then polls the local run store for terminal status.
 * The subprocess approach keeps isolation honest — the harness never shares
 * the operator's workflow runtime or project state with a running fixture.
 *
 * This executor requires the target fixture working directory to have the
 * minimal KOTA project setup the autonomy workflows need (e.g. `.kota/`
 * state, `data/` queue). Fixture authors prepare that in `initial/`.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  WorkflowExecutionOutcome,
  WorkflowExecutionRequest,
  WorkflowExecutor,
} from "./runner.js";

export type SubprocessExecutorOptions = {
  /** Path to the `kota` binary (`./bin/kota.mjs` when running from the repo). */
  kotaBinaryPath: string;
  /**
   * Poll interval for checking the fixture's run store. Keep this short
   * enough that a fast fixture is not penalized but long enough to avoid
   * burning CPU — default 2 seconds.
   */
  pollIntervalMs?: number;
  /**
   * Extra env vars to forward to the subprocess. The fixture's HOME is
   * deliberately pointed at the working directory so credential-driven side
   * effects cannot leak from the operator's real environment.
   */
  extraEnv?: Record<string, string>;
};

const DEFAULT_POLL_INTERVAL_MS = 2000;

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
    try {
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
    } catch {
      // Corrupt run directory — skip; the poll loop will see the next tick.
    }
  }
  return null;
}

async function waitForTerminalRun(
  workingDir: string,
  workflowName: string,
  deadlineMs: number,
  pollIntervalMs: number,
  signal: AbortSignal,
): Promise<RunMetadataSnapshot | null> {
  while (Date.now() < deadlineMs) {
    if (signal.aborted) return null;
    const terminal = readTerminalRunForWorkflow(workingDir, workflowName);
    if (terminal) return terminal;
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
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
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  return {
    async execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionOutcome> {
      const startMs = Date.now();
      const deadlineMs = startMs + request.budgetMs;
      const controller = new AbortController();

      const env = {
        ...process.env,
        ...(options.extraEnv ?? {}),
        HOME: request.workingDir,
        KOTA_PROJECT_DIR: request.workingDir,
      };

      const triggerArgs = [
        options.kotaBinaryPath,
        "workflow",
        "trigger",
        request.workflowName,
        "--force",
      ];
      if (request.triggerPayload !== undefined) {
        triggerArgs.push("--payload", JSON.stringify(request.triggerPayload));
      }
      const child = spawn("node", triggerArgs, {
        cwd: request.workingDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.resume();
      child.stderr.resume();

      const budgetTimer = setTimeout(() => {
        controller.abort();
        child.kill("SIGTERM");
      }, request.budgetMs);

      const triggerExit = await new Promise<number | null>((resolve) => {
        child.on("exit", (code) => resolve(code));
        child.on("error", () => resolve(null));
      });

      if (triggerExit !== 0) {
        clearTimeout(budgetTimer);
        return {
          kind: "error",
          durationMs: Date.now() - startMs,
          message: `kota workflow trigger exited with status ${triggerExit}.`,
          runArtifactPath: null,
        };
      }

      const terminal = await waitForTerminalRun(
        request.workingDir,
        request.workflowName,
        deadlineMs,
        pollIntervalMs,
        controller.signal,
      );
      clearTimeout(budgetTimer);

      if (!terminal) {
        return {
          kind: "timeout",
          durationMs: Date.now() - startMs,
          runArtifactPath: null,
        };
      }

      const runArtifactPath = join(
        request.workingDir,
        ".kota",
        "runs",
        terminal.id,
      );
      return {
        kind: "completed",
        durationMs: Date.now() - startMs,
        runArtifactPath,
      };
    },
  };
}
