import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  resolveTaskProbeSandbox,
  type TaskProbeSandbox,
} from "#core/agent-harness/task-probe-sandbox.js";
import { buildRequiredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import {
  WorkflowCommandError,
  type WorkflowCommandRunner,
} from "#core/workflow/workflow-command.js";
import type { TaskProbe, TaskProbeResult } from "./task-probe.js";

const MAX_PROBE_OUTPUT_CHARS = 20_000;
const MAX_PROBE_OUTPUT_BYTES = 256 * 1024;

export async function runTaskProbe(
  probe: TaskProbe,
  projectDir: string,
  runCommand: WorkflowCommandRunner,
): Promise<TaskProbeResult> {
  return runTaskProbeInSandbox(
    probe,
    projectDir,
    resolveTaskProbeSandbox(projectDir, probe.timeoutMs),
    runCommand,
  );
}

async function runTaskProbeInSandbox(
  probe: TaskProbe,
  projectDir: string,
  sandbox: TaskProbeSandbox,
  runCommand: WorkflowCommandRunner,
): Promise<TaskProbeResult> {
  if (sandbox.status === "unavailable") {
    return {
      verdict: "fail",
      exitCode: -1,
      durationMs: 0,
      output: `Runtime Probe not executed: ${sandbox.reason}`,
      probe,
      execution: "not-executed",
      isolation: sandbox,
    };
  }

  const runtimeHome = mkdtempSync(join(projectDir, ".kota-runtime-probe-"));
  const start = Date.now();
  try {
    const result = await runCommand({
      command: sandbox.command,
      args: [
        ...sandbox.prefixArgs,
        sandbox.probeExecutable,
        ...probe.args,
      ],
      cwd: projectDir,
      env: buildTaskProbeEnv(runtimeHome),
      envMode: "replace",
      timeoutMs: probe.timeoutMs,
      outputLimitBytes: MAX_PROBE_OUTPUT_BYTES,
      captureLimitBytesPerStream: MAX_PROBE_OUTPUT_CHARS,
    });
    return taskProbeResult({
      probe,
      sandbox,
      durationMs: Date.now() - start,
      exitCode: 0,
      output: [result.stdout.text, result.stderr.text]
        .filter((part) => part.length > 0)
        .join("\n"),
    });
  } catch (error) {
    if (!(error instanceof WorkflowCommandError)) throw error;
    return taskProbeResult({
      probe,
      sandbox,
      durationMs: Date.now() - start,
      exitCode: error.kind === "timed-out" ? 124 : (error.exitCode ?? -1),
      output: error.message,
    });
  } finally {
    rmSync(runtimeHome, { recursive: true, force: true });
  }
}

function taskProbeResult(args: {
  probe: TaskProbe;
  sandbox: Extract<TaskProbeSandbox, { status: "available" }>;
  durationMs: number;
  exitCode: number;
  output: string;
}): TaskProbeResult {
  return {
    verdict: args.exitCode === 0 ? "pass" : "fail",
    exitCode: args.exitCode,
    durationMs: args.durationMs,
    output: truncateTail(args.output, MAX_PROBE_OUTPUT_CHARS),
    probe: args.probe,
    execution: "os-contained-command",
    isolation: {
      status: "enforced",
      kind: args.sandbox.kind,
      processBoundary: args.sandbox.processBoundary,
      evidence: args.sandbox.evidence,
    },
  };
}

function buildTaskProbeEnv(runtimeHome: string): NodeJS.ProcessEnv {
  return {
    ...buildRequiredInheritedSubprocessEnv(),
    HOME: runtimeHome,
    TMPDIR: runtimeHome,
    NO_COLOR: "1",
    KOTA_RUNTIME_PROBE: "1",
  };
}

function truncateTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `[... ${text.length - limit} chars truncated - showing tail ...]\n${text.slice(-limit)}`;
}
